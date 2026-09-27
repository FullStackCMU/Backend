import { dbClient } from "@db/client.js";
import {
  consentsTable,
  groupMembersTable,
  groupsTable,
  questionsTable,
  ratingsTable,
  roundsTable,
  submissionsTable,
  usersTable,
} from "@db/schema.js";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Router, type Request } from "express";
import { CONSENT_POLICY_VERSION } from "../config.ts";
import { checkComments } from "../lib/comment-check.ts";
import { personColumns, toPerson } from "../lib/course-members.ts";
import {
  authenticate,
  requireCourseRole,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

export const MAX_COMMENT_LENGTH = 500;

function httpError(status: number, message: string) {
  const err: any = new Error(message);
  err.statusCode = status;
  return err;
}

async function findRound(roundId: string) {
  const [round] = await dbClient.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) throw httpError(404, "ไม่พบรอบประเมินนี้");
  return round;
}
const courseIdOfRound = async (req: Request) => (await findRound(String(req.params.roundId))).courseId;

type Blocker = { status: number; message: string } | null;

/**
 * ทุกอย่างที่ต้องใช้ทำแบบประเมินรอบหนึ่งของนักศึกษา 1 คน + เหตุผลที่ยังแก้ไม่ได้ (blocker)
 * กลุ่ม: ถ้ามี submission แล้วใช้กลุ่มของ submission (เปลี่ยนกลุ่มถูกล็อกระหว่างรอบอยู่แล้ว)
 */
async function loadContext(roundId: string, userId: string) {
  const round = await findRound(roundId);
  const now = new Date();

  const [submission] = await dbClient
    .select()
    .from(submissionsTable)
    .where(and(eq(submissionsTable.roundId, roundId), eq(submissionsTable.evaluatorId, userId)));

  const [membership] = await dbClient
    .select({
      groupId: groupMembersTable.groupId,
      contractAcceptedAt: groupMembersTable.contractAcceptedAt,
    })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.courseId, round.courseId),
        eq(groupMembersTable.userId, userId),
        isNull(groupMembersTable.leftAt)
      )
    );

  const groupId = submission?.groupId ?? membership?.groupId ?? null;
  const [group] = groupId
    ? await dbClient
        .select({ id: groupsTable.id, name: groupsTable.name, contractText: groupsTable.contractText })
        .from(groupsTable)
        .where(eq(groupsTable.id, groupId))
    : [];

  // ผู้ถูกประเมิน = สมาชิกปัจจุบันของกลุ่ม (รวมตัวเอง) — ตัวเองขึ้นก่อน
  const members = group
    ? await dbClient
        .select(personColumns)
        .from(groupMembersTable)
        .innerJoin(usersTable, eq(usersTable.id, groupMembersTable.userId))
        .where(and(eq(groupMembersTable.groupId, group.id), isNull(groupMembersTable.leftAt)))
        .orderBy(asc(groupMembersTable.joinedAt))
    : [];
  const targets = [
    ...members.filter((m) => m.id === userId),
    ...members.filter((m) => m.id !== userId),
  ].map((m) => ({ ...toPerson(m), isSelf: m.id === userId }));

  const questions = await dbClient.select().from(questionsTable).orderBy(asc(questionsTable.orderNo));

  const answers = submission
    ? await dbClient
        .select({
          questionId: ratingsTable.questionId,
          evaluateeId: ratingsTable.evaluateeId,
          score: ratingsTable.score,
          comment: ratingsTable.comment,
        })
        .from(ratingsTable)
        .where(eq(ratingsTable.submissionId, submission.id))
    : [];

  const [consent] = await dbClient
    .select({ id: consentsTable.id })
    .from(consentsTable)
    .where(
      and(
        eq(consentsTable.userId, userId),
        eq(consentsTable.policyVersion, CONSENT_POLICY_VERSION),
        isNull(consentsTable.withdrawnAt)
      )
    );

  // เหตุผลที่ยังบันทึก/ส่งไม่ได้ เรียงตามลำดับที่ควรแจ้งผู้ใช้
  let blocker: Blocker = null;
  if (submission?.status === "submitted") blocker = { status: 409, message: "คุณส่งแบบประเมินรอบนี้แล้ว แก้ไขไม่ได้" };
  else if (now < round.opensAt) blocker = { status: 409, message: "รอบนี้ยังไม่เปิดรับ" };
  else if (now >= round.closesAt) blocker = { status: 409, message: "รอบนี้ปิดรับแล้ว" };
  else if (!consent) blocker = { status: 403, message: "ต้องยอมรับนโยบายความเป็นส่วนตัวก่อนทำแบบประเมิน" };
  else if (!membership || !group) blocker = { status: 409, message: "ต้องเข้ากลุ่มก่อนจึงทำแบบประเมินได้" };
  else if (membership.groupId !== group.id)
    blocker = { status: 409, message: "กลุ่มของคุณเปลี่ยนไปหลังเริ่มทำแบบประเมิน กรุณาติดต่ออาจารย์" };
  else if (group.contractText && !membership.contractAcceptedAt)
    blocker = { status: 409, message: "ต้องยอมรับข้อตกลงกลุ่มก่อนจึงทำแบบประเมินได้" };

  return { round, submission, group: group ?? null, targets, questions, answers, blocker };
}

type Context = Awaited<ReturnType<typeof loadContext>>;

function toResponse(ctx: Context) {
  return {
    round: {
      id: ctx.round.id,
      courseId: ctx.round.courseId,
      sequenceNo: ctx.round.sequenceNo,
      opensAt: ctx.round.opensAt,
      closesAt: ctx.round.closesAt,
      scaleMin: ctx.round.scaleMin,
      scaleMax: ctx.round.scaleMax,
    },
    group: ctx.group ? { id: ctx.group.id, name: ctx.group.name } : null,
    targets: ctx.targets,
    questions: ctx.questions.map((q) => ({ id: q.id, orderNo: q.orderNo, type: q.type, prompt: q.prompt })),
    submission: ctx.submission
      ? { status: ctx.submission.status, submittedAt: ctx.submission.submittedAt }
      : null,
    answers: ctx.answers,
    /** null = บันทึก/ส่งได้ */
    blocker: ctx.blocker?.message ?? null,
  };
}

type AnswerRow = { questionId: string; evaluateeId: string; score: number | null; comment: string | null };

/**
 * ตรวจคำตอบจาก client — rating: score เป็นจำนวนเต็มในสเกลของรอบ, text: comment ไม่เกิน 500 ตัวอักษร
 * ประเมินได้เฉพาะสมาชิกในกลุ่มตัวเอง แถวที่ยังไม่ตอบ (ว่าง) ไม่ต้องเก็บ
 */
function parseAnswers(input: unknown, ctx: Context): AnswerRow[] {
  if (!Array.isArray(input)) throw new Error("answers ต้องเป็น array");
  const questions = new Map(ctx.questions.map((q) => [q.id, q]));
  const targetIds = new Set(ctx.targets.map((t) => t.id));
  const rows = new Map<string, AnswerRow>();

  for (const raw of input) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const question = questions.get(String(a.questionId));
    if (!question) throw new Error("พบคำถามที่ไม่อยู่ในแบบประเมิน");
    const evaluateeId = String(a.evaluateeId);
    if (!targetIds.has(evaluateeId)) throw httpError(403, "ประเมินได้เฉพาะสมาชิกในกลุ่มของคุณ");

    let row: AnswerRow;
    if (question.type === "rating") {
      if (a.score === null || a.score === undefined) continue;
      const score = Number(a.score);
      if (!Number.isInteger(score) || score < ctx.round.scaleMin || score > ctx.round.scaleMax)
        throw new Error(`คะแนนต้องอยู่ระหว่าง ${ctx.round.scaleMin}–${ctx.round.scaleMax}`);
      row = { questionId: question.id, evaluateeId, score, comment: null };
    } else {
      const comment = typeof a.comment === "string" ? a.comment : "";
      if (comment.length > MAX_COMMENT_LENGTH)
        throw new Error(`ความเห็นยาวได้ไม่เกิน ${MAX_COMMENT_LENGTH} ตัวอักษร`);
      if (!comment.trim()) continue;
      row = { questionId: question.id, evaluateeId, score: null, comment };
    }
    rows.set(`${row.questionId}:${row.evaluateeId}`, row);
  }
  return [...rows.values()];
}

/** บันทึกคำตอบทั้งชุดแทนของเดิม (client ส่งคำตอบทั้งหมดที่มีทุกครั้ง) คืน submission id */
async function saveDraft(ctx: Context, userId: string, rows: AnswerRow[]) {
  return dbClient.transaction(async (tx) => {
    let submissionId = ctx.submission?.id;
    if (!submissionId) {
      const [created] = await tx
        .insert(submissionsTable)
        .values({ roundId: ctx.round.id, groupId: ctx.group!.id, evaluatorId: userId, status: "draft" })
        .onConflictDoNothing()
        .returning({ id: submissionsTable.id });
      // กดบันทึกพร้อมกันสองแท็บ → อีกแท็บสร้างไปแล้ว
      submissionId =
        created?.id ??
        (
          await tx
            .select({ id: submissionsTable.id })
            .from(submissionsTable)
            .where(and(eq(submissionsTable.roundId, ctx.round.id), eq(submissionsTable.evaluatorId, userId)))
        )[0].id;
    }
    await tx.delete(ratingsTable).where(eq(ratingsTable.submissionId, submissionId));
    if (rows.length > 0)
      await tx.insert(ratingsTable).values(rows.map((r) => ({ ...r, submissionId })));
    return submissionId;
  });
}

const roundAccess = requireCourseRole("student", courseIdOfRound);

// GET /answers/:roundId — ข้อมูลทำแบบประเมิน + คำตอบที่บันทึกไว้ + blocker (null = แก้ได้)
router.get("/:roundId", authenticate, roundAccess, async (req: AuthedRequest, res, next) => {
  try {
    const ctx = await loadContext(String(req.params.roundId), req.user!.id);
    res.json({ msg: "Fetch evaluation successfully", data: toResponse(ctx) });
  } catch (err) {
    next(err);
  }
});

// PUT /answers/:roundId/draft { answers } — บันทึกร่าง (ตอบไม่ครบได้)
router.put("/:roundId/draft", authenticate, roundAccess, async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const ctx = await loadContext(String(req.params.roundId), userId);
    if (ctx.blocker) throw httpError(ctx.blocker.status, ctx.blocker.message);

    await saveDraft(ctx, userId, parseAnswers(req.body?.answers, ctx));
    res.json({
      msg: "Save draft successfully",
      data: toResponse(await loadContext(ctx.round.id, userId)),
    });
  } catch (err) {
    next(err);
  }
});

// POST /answers/:roundId/submit { answers } — บันทึกแล้วส่ง (ต้องตอบครบทุกข้อ ทุกคน) ส่งแล้วแก้ไม่ได้
router.post("/:roundId/submit", authenticate, roundAccess, async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const ctx = await loadContext(String(req.params.roundId), userId);
    if (ctx.blocker) throw httpError(ctx.blocker.status, ctx.blocker.message);

    const rows = parseAnswers(req.body?.answers, ctx);
    const answered = new Set(rows.map((r) => `${r.questionId}:${r.evaluateeId}`));
    const missing = ctx.questions.filter((q) => ctx.targets.some((t) => !answered.has(`${q.id}:${t.id}`)));
    if (missing.length > 0)
      throw httpError(
        422,
        `ยังตอบไม่ครบ: คำถามข้อ ${missing.map((q) => q.orderNo).join(", ")}`
      );

    const submissionId = await saveDraft(ctx, userId, rows);

    // ตรวจข้อความก่อนส่ง (AI flagger เสียบใน lib/comment-check.ts) — มีปัญหา = ยังไม่ส่ง ให้แก้ก่อน
    const issues = await checkComments({
      submissionId,
      comments: rows
        .filter((r) => r.comment)
        .map((r) => ({ questionId: r.questionId, evaluateeId: r.evaluateeId, text: r.comment! })),
    });
    if (issues.length > 0) {
      const err = httpError(422, "มีข้อความที่ควรปรับก่อนส่ง");
      err.issues = issues;
      throw err;
    }

    await dbClient
      .update(submissionsTable)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(and(eq(submissionsTable.id, submissionId), eq(submissionsTable.status, "draft")));

    res.json({
      msg: "Submit evaluation successfully",
      data: toResponse(await loadContext(ctx.round.id, userId)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
