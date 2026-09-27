/**
 * AI flagger — ตรวจข้อความความเห็นในแบบประเมินแล้ว "เตือน ไม่บล็อก"
 *
 * ความเป็นส่วนตัว:
 * - ส่งให้ AI แค่ข้อความที่ลบชื่อสมาชิกกลุ่ม/รหัส/อีเมลแล้ว (redact.ts) ไม่ส่ง id หรือข้อมูลผู้ใช้
 * - ไม่เก็บข้อความลง DB และไม่ log ข้อความ — cache ในหน่วยความจำเก็บแค่ hash → ผลตรวจ
 *
 * ตาราง flags: 1 แถว = 1 ครั้งที่ความเห็นช่องหนึ่ง (submission × question × evaluatee) ถูกเตือน
 *   pending → edited  : แก้ข้อความแล้วตรวจผ่าน
 *   pending → ignored : กดส่งแบบประเมินทั้งที่ข้อความยังถูกเตือน ("ส่งตามนี้")
 * ถูกเตือนซ้ำระหว่างที่ยัง pending (แก้แล้วยังไม่ผ่าน) = อัปเดตแถวเดิม ไม่นับเป็นครั้งใหม่
 */
import { createHash } from "node:crypto";
import Debug from "debug";
import { dbClient } from "@db/client.js";
import { flagsTable } from "@db/schema.js";
import { and, eq } from "drizzle-orm";
import { COMMENT_CHECK_TIMEOUT_MS } from "../../config.ts";
import { createChecker } from "./providers.ts";
import { redactPersonalInfo } from "./redact.ts";
import type { CommentChecker, FlagCategory, FlagSeverity, Verdict } from "./types.ts";

export { nameVariants } from "./redact.ts";

const debug = Debug("pf-backend:comment-check");

let checker: CommentChecker | null | undefined;
/** สร้างครั้งแรกที่ใช้ (หลัง dotenv โหลดแล้ว) */
export function getChecker() {
  if (checker === undefined) checker = createChecker();
  return checker;
}

export interface CommentToCheck {
  questionId: string;
  evaluateeId: string;
  text: string;
}

export interface CommentWarning {
  questionId: string;
  evaluateeId: string;
  category: FlagCategory;
  severity: FlagSeverity;
  suggestion: string;
}

/** verdict null = ตรวจไม่ได้ (ปิดการตรวจ / error / timeout) → ถือว่าผ่าน */
export interface CheckOutcome {
  questionId: string;
  evaluateeId: string;
  verdict: Verdict | null;
}

// ── cache: sha256(model + ข้อความที่ redact แล้ว) → ผลตรวจ ─────────────────────
// ข้อความเดิมไม่ต้องส่งซ้ำ (กดถัดไปแล้วกดส่ง, ย้อนกลับไปมา) — หายเมื่อ restart ก็แค่ตรวจใหม่
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
const cache = new Map<string, { verdict: Verdict; expires: number }>();
const inflight = new Map<string, Promise<Verdict>>();

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.verdict;
}

function cacheSet(key: string, verdict: Verdict) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { verdict, expires: Date.now() + CACHE_TTL_MS });
}

/** ตรวจ 1 ข้อความ (redact แล้ว) — ใช้ cache และรวมคำขอซ้ำที่กำลังรออยู่ */
function checkOne(active: CommentChecker, text: string, signal: AbortSignal): Promise<Verdict> {
  const key = createHash("sha256").update(`${active.modelVersion}\0${text}`).digest("hex");
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);
  let pending = inflight.get(key);
  if (!pending) {
    pending = active
      .check(text, signal)
      .then((verdict) => {
        cacheSet(key, verdict);
        return verdict;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/** เหตุผลที่ตรวจไม่สำเร็จ — ห้ามใส่ข้อความหรือคำตอบของโมเดล */
function failureReason(err: unknown) {
  const e = err as { name?: string; status?: number; message?: string };
  if (e?.name === "AbortError" || e?.name === "APIUserAbortError" || e?.name === "TimeoutError") return "timeout";
  if (typeof e?.status === "number") return `http_${e.status}`;
  if (e?.message && /^[a-z_]+$/.test(e.message)) return e.message; // โค้ดที่เรา throw เอง
  return e?.name ?? "unknown";
}

/**
 * ตรวจความเห็นทั้งชุดพร้อมกัน (จำกัดเวลารวม COMMENT_CHECK_TIMEOUT_MS) แล้วบันทึกลง flags
 * names = ชื่อทุกแบบของสมาชิกกลุ่ม ที่ต้องลบออกก่อนส่ง
 */
export async function checkComments(input: {
  submissionId: string;
  comments: CommentToCheck[];
  names: readonly string[];
}): Promise<CheckOutcome[]> {
  const active = getChecker();
  if (!active || input.comments.length === 0)
    return input.comments.map((c) => ({ questionId: c.questionId, evaluateeId: c.evaluateeId, verdict: null }));

  const signal = AbortSignal.timeout(COMMENT_CHECK_TIMEOUT_MS);
  const settled = await Promise.allSettled(
    input.comments.map((c) => checkOne(active, redactPersonalInfo(c.text, input.names), signal))
  );
  const outcomes = input.comments.map((c, i): CheckOutcome => {
    const s = settled[i];
    if (s.status === "rejected") debug(`check failed (${failureReason(s.reason)}) — ปล่อยผ่าน`);
    return {
      questionId: c.questionId,
      evaluateeId: c.evaluateeId,
      verdict: s.status === "fulfilled" ? s.value : null,
    };
  });

  await recordFlags(input.submissionId, outcomes, active.modelVersion);
  return outcomes;
}

export function toWarnings(outcomes: CheckOutcome[]): CommentWarning[] {
  return outcomes.flatMap((o) =>
    o.verdict?.flagged
      ? [
          {
            questionId: o.questionId,
            evaluateeId: o.evaluateeId,
            category: o.verdict.category,
            severity: o.verdict.severity,
            suggestion: o.verdict.suggestion,
          },
        ]
      : []
  );
}

const flagKey = (f: { questionId: string; evaluateeId: string | null }) => `${f.questionId}:${f.evaluateeId}`;

async function recordFlags(submissionId: string, outcomes: CheckOutcome[], modelVersion: string) {
  const pending = await dbClient
    .select({ id: flagsTable.id, questionId: flagsTable.questionId, evaluateeId: flagsTable.evaluateeId })
    .from(flagsTable)
    .where(and(eq(flagsTable.submissionId, submissionId), eq(flagsTable.studentAction, "pending")));
  const pendingByKey = new Map(pending.map((f) => [flagKey(f), f.id]));

  for (const o of outcomes) {
    if (!o.verdict) continue; // ตรวจไม่ได้ → ไม่รู้ว่าแก้แล้วผ่านหรือไม่ คงสถานะเดิม
    const existing = pendingByKey.get(flagKey(o));
    if (o.verdict.flagged) {
      const values = {
        category: o.verdict.category,
        severity: o.verdict.severity,
        aiSuggestion: o.verdict.suggestion,
        modelVersion,
      };
      if (existing) await dbClient.update(flagsTable).set(values).where(eq(flagsTable.id, existing));
      else
        await dbClient
          .insert(flagsTable)
          .values({ submissionId, questionId: o.questionId, evaluateeId: o.evaluateeId, ...values });
    } else if (existing) {
      await dbClient.update(flagsTable).set({ studentAction: "edited" }).where(eq(flagsTable.id, existing));
    }
  }
}

/** ตอนกดส่งแบบประเมิน: ข้อความที่ยังถูกเตือนอยู่ = นักศึกษาเลือก "ส่งตามนี้" */
export async function markIgnored(
  tx: Pick<typeof dbClient, "update">,
  submissionId: string,
  warnings: CommentWarning[]
) {
  for (const w of warnings)
    await tx
      .update(flagsTable)
      .set({ studentAction: "ignored" })
      .where(
        and(
          eq(flagsTable.submissionId, submissionId),
          eq(flagsTable.questionId, w.questionId),
          eq(flagsTable.evaluateeId, w.evaluateeId),
          eq(flagsTable.studentAction, "pending")
        )
      );
}
