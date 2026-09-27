import { dbClient } from "@db/client.js";
import {
  coursesTable,
  enrollmentsTable,
  groupMembersTable,
  groupsTable,
  questionsTable,
  ratingsTable,
  roundsTable,
  submissionsTable,
} from "@db/schema.js";
import { and, asc, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { Router, type Request } from "express";
import {
  authenticate,
  requireCourseRole,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

// ผลประเมินของนักศึกษา — เปิดให้ดูตาม release ของอาจารย์ (บังคับที่ API ไม่ใช่แค่ซ่อนที่หน้าเว็บ)
// ห้ามส่ง evaluator_id / submission id ของคนอื่นออกไปเด็ดขาด
const router = Router();

function httpError(status: number, message: string) {
  const err: any = new Error(message);
  err.statusCode = status;
  return err;
}

const isReleased = (at: Date | null, now: Date) => at !== null && at <= now;

/** สลับลำดับแบบสุ่ม (Fisher–Yates) — ความเห็นต้องไม่เรียงตามคนเขียน */
function shuffle<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// GET /feedback — รอบที่ดูผลได้แล้ว จากทุกวิชาที่เป็นนักศึกษา (ใหม่สุดก่อน)
router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const now = new Date();
    const rows = await dbClient
      .select({
        roundId: roundsTable.id,
        sequenceNo: roundsTable.sequenceNo,
        scoresReleasedAt: roundsTable.scoresReleasedAt,
        feedbackReleasedAt: roundsTable.feedbackReleasedAt,
        courseId: coursesTable.id,
        courseCode: coursesTable.courseCode,
        section: coursesTable.section,
        courseTitle: coursesTable.title,
      })
      .from(enrollmentsTable)
      .innerJoin(coursesTable, eq(coursesTable.id, enrollmentsTable.courseId))
      .innerJoin(roundsTable, eq(roundsTable.courseId, coursesTable.id))
      .where(
        and(
          eq(enrollmentsTable.userId, req.user!.id),
          eq(enrollmentsTable.role, "student"),
          or(lte(roundsTable.scoresReleasedAt, now), lte(roundsTable.feedbackReleasedAt, now))
        )
      );

    const data = rows
      .map((r) => ({
        ...r,
        releasedAt: [r.scoresReleasedAt, r.feedbackReleasedAt]
          .filter((d): d is Date => d !== null && d <= now)
          .reduce((a, b) => (b > a ? b : a)),
      }))
      .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());

    res.json({ msg: "Fetch feedback list successfully", data });
  } catch (err) {
    next(err);
  }
});

async function findRound(roundId: string) {
  const [round] = await dbClient.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) throw httpError(404, "ไม่พบรอบประเมินนี้");
  return round;
}
const courseIdOfRound = async (req: Request) => (await findRound(String(req.params.roundId))).courseId;

// GET /feedback/rounds/:roundId — ผลประเมินของฉันในรอบนี้
//   scores   (มีเมื่อ scores_released_at ถึงแล้ว): ค่าเฉลี่ยจากเพื่อนรายข้อ เทียบกับคะแนนที่ให้ตัวเอง
//   comments (มีเมื่อ feedback_released_at ถึงแล้ว): ความเห็นจากเพื่อน ไม่ระบุชื่อ สลับลำดับ
//   ยังไม่ release → เป็น null (หน้าเว็บแสดงว่ารออาจารย์เผยแพร่)
router.get(
  "/rounds/:roundId",
  authenticate,
  requireCourseRole("student", courseIdOfRound),
  async (req: AuthedRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const now = new Date();
      const round = await findRound(String(req.params.roundId));
      const [course] = await dbClient
        .select({
          id: coursesTable.id,
          courseCode: coursesTable.courseCode,
          section: coursesTable.section,
          title: coursesTable.title,
        })
        .from(coursesTable)
        .where(eq(coursesTable.id, round.courseId));

      const [mine] = await dbClient
        .select({
          groupId: submissionsTable.groupId,
          status: submissionsTable.status,
          submittedAt: submissionsTable.submittedAt,
        })
        .from(submissionsTable)
        .where(and(eq(submissionsTable.roundId, round.id), eq(submissionsTable.evaluatorId, userId)));

      // คะแนน/ความเห็นที่ "เพื่อน" ให้ฉัน จาก submission ที่ส่งแล้วเท่านั้น
      // evaluatorId ใช้นับจำนวนคนภายใน server เท่านั้น — ไม่ส่งออก
      const received = await dbClient
        .select({
          evaluatorId: submissionsTable.evaluatorId,
          groupId: submissionsTable.groupId,
          questionId: ratingsTable.questionId,
          score: ratingsTable.score,
          comment: ratingsTable.comment,
        })
        .from(ratingsTable)
        .innerJoin(submissionsTable, eq(submissionsTable.id, ratingsTable.submissionId))
        .where(
          and(
            eq(submissionsTable.roundId, round.id),
            eq(submissionsTable.status, "submitted"),
            eq(ratingsTable.evaluateeId, userId),
            ne(submissionsTable.evaluatorId, userId)
          )
        );

      // กลุ่มของรอบนี้: จาก submission ของตัวเอง → กลุ่มของเพื่อนที่ประเมินฉัน → กลุ่มปัจจุบัน
      const [current] =
        mine || received.length
          ? []
          : await dbClient
              .select({ groupId: groupMembersTable.groupId })
              .from(groupMembersTable)
              .where(
                and(
                  eq(groupMembersTable.courseId, round.courseId),
                  eq(groupMembersTable.userId, userId),
                  isNull(groupMembersTable.leftAt)
                )
              );
      const groupId = mine?.groupId ?? received[0]?.groupId ?? current?.groupId ?? null;
      const [group] = groupId
        ? await dbClient.select({ name: groupsTable.name }).from(groupsTable).where(eq(groupsTable.id, groupId))
        : [];

      const questions = await dbClient.select().from(questionsTable).orderBy(asc(questionsTable.orderNo));

      const scoresReleased = isReleased(round.scoresReleasedAt, now);
      const feedbackReleased = isReleased(round.feedbackReleasedAt, now);

      let scores = null;
      if (scoresReleased) {
        // คะแนนที่ฉันให้ตัวเอง (เฉพาะที่ส่งแล้ว)
        const selfRatings =
          mine?.status === "submitted"
            ? await dbClient
                .select({ questionId: ratingsTable.questionId, score: ratingsTable.score })
                .from(ratingsTable)
                .innerJoin(submissionsTable, eq(submissionsTable.id, ratingsTable.submissionId))
                .where(
                  and(
                    eq(submissionsTable.roundId, round.id),
                    eq(submissionsTable.evaluatorId, userId),
                    eq(ratingsTable.evaluateeId, userId),
                    inArray(ratingsTable.questionId, questions.map((q) => q.id))
                  )
                )
            : [];

        scores = questions
          .filter((q) => q.type === "rating")
          .map((q) => {
            const peer = received.filter((r) => r.questionId === q.id && r.score !== null).map((r) => r.score!);
            const self = selfRatings.find((r) => r.questionId === q.id)?.score ?? null;
            return {
              questionId: q.id,
              orderNo: q.orderNo,
              prompt: q.prompt,
              peerAverage: peer.length ? round1(peer.reduce((a, b) => a + b, 0) / peer.length) : null,
              peerCount: peer.length,
              selfScore: self,
            };
          });
      }

      const comments = feedbackReleased
        ? questions
            .filter((q) => q.type === "text")
            .map((q) => ({
              questionId: q.id,
              orderNo: q.orderNo,
              prompt: q.prompt,
              comments: shuffle(
                received.filter((r) => r.questionId === q.id && r.comment?.trim()).map((r) => r.comment!)
              ),
            }))
        : null;

      res.json({
        msg: "Fetch feedback successfully",
        data: {
          round: {
            id: round.id,
            sequenceNo: round.sequenceNo,
            opensAt: round.opensAt,
            closesAt: round.closesAt,
            scaleMin: round.scaleMin,
            scaleMax: round.scaleMax,
            scoresReleasedAt: scoresReleased ? round.scoresReleasedAt : null,
            feedbackReleasedAt: feedbackReleased ? round.feedbackReleasedAt : null,
          },
          course,
          groupName: group?.name ?? null,
          mySubmission: mine ? { status: mine.status, submittedAt: mine.submittedAt } : null,
          /** จำนวนเพื่อนที่ส่งแบบประเมินให้ฉัน */
          peerCount: new Set(received.map((r) => r.evaluatorId)).size,
          scores,
          comments,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
