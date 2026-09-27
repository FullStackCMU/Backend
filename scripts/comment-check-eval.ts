/**
 * วัดผล AI flagger กับชุดทดสอบ: precision / recall / เวลาตอบ
 *   pnpm run eval:comments
 *
 * ใช้ provider + prompt + การแทนชื่อชุดเดียวกับของจริง (ไม่แตะ DB ไม่ใช้ cache)
 * ตรวจทีละข้อตามลำดับ เพื่อวัดเวลาตอบของแต่ละคำขอ — timeout/error นับเป็น "ไม่เตือน" เหมือนระบบจริง
 */
import "dotenv/config";
import { COMMENT_CHECK_TIMEOUT_MS } from "../src/config.ts";
import { createChecker } from "../src/lib/comment-check/providers.ts";
import { redactPersonalInfo } from "../src/lib/comment-check/redact.ts";
import type { Verdict } from "../src/lib/comment-check/types.ts";
import { EVAL_CASES, EVAL_GROUP_NAMES } from "./comment-check-cases.ts";

const checker = createChecker();
if (!checker) {
  console.error("AI_PROVIDER ปิดอยู่หรือตั้งค่าไม่ครบ — ดู warning ด้านบน");
  process.exit(1);
}

type Row = { id: string; expect: string; got: "flag" | "pass"; ms: number; verdict: Verdict | null; error?: string };
const rows: Row[] = [];

console.log(`model: ${checker.modelVersion}  timeout: ${COMMENT_CHECK_TIMEOUT_MS}ms  cases: ${EVAL_CASES.length}\n`);

for (const c of EVAL_CASES) {
  const text = redactPersonalInfo(c.text, EVAL_GROUP_NAMES);
  const start = performance.now();
  let verdict: Verdict | null = null;
  let error: string | undefined;
  try {
    verdict = await checker.check(text, AbortSignal.timeout(COMMENT_CHECK_TIMEOUT_MS));
  } catch (err) {
    const e = err as { name?: string; status?: number; message?: string };
    error = e.name === "APIUserAbortError" || e.name === "TimeoutError" ? "timeout" : (e.status ? `http_${e.status}` : e.message);
  }
  const ms = performance.now() - start;
  const got = verdict?.flagged ? "flag" : "pass";
  rows.push({ id: c.id, expect: c.expect, got, ms, verdict, error });

  const mark = got === c.expect ? "✓" : "✗";
  const detail = verdict?.flagged ? `${verdict.category}/${verdict.severity}` : error ? `error:${error}` : "-";
  console.log(`${mark} ${c.id} ${c.expect.padEnd(4)} → ${got.padEnd(4)} ${String(Math.round(ms)).padStart(5)}ms  ${detail.padEnd(24)} ${c.note}`);
  if (text !== c.text) console.log(`      ส่งจริง: ${text}`);
  if (verdict?.flagged) console.log(`      แนะนำ: ${verdict.suggestion}`);
}

const tp = rows.filter((r) => r.expect === "flag" && r.got === "flag").length;
const fp = rows.filter((r) => r.expect === "pass" && r.got === "flag").length;
const fn = rows.filter((r) => r.expect === "flag" && r.got === "pass").length;
const tn = rows.filter((r) => r.expect === "pass" && r.got === "pass").length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const times = rows.map((r) => r.ms).sort((a, b) => a - b);
const quantile = (q: number) => times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)];
const categoryHits = EVAL_CASES.filter((c, i) => c.category && rows[i].verdict?.flagged && rows[i].verdict.category === c.category).length;

console.log(`
TP ${tp}  FP ${fp}  FN ${fn}  TN ${tn}
precision ${pct(tp / (tp + fp || 1))}   recall ${pct(tp / (tp + fn || 1))}   accuracy ${pct((tp + tn) / rows.length)}
ประเภทตรงกับที่คาด ${categoryHits}/${tp} ข้อที่เตือนถูก
เวลาตอบ เฉลี่ย ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms  p50 ${Math.round(quantile(0.5))}ms  p95 ${Math.round(quantile(0.95))}ms  สูงสุด ${Math.round(times.at(-1)!)}ms
error/timeout ${rows.filter((r) => r.error).length} ข้อ`);
