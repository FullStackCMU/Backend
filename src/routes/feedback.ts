import { dbClient } from "@db/client.js";
import {
  coursesTable,
  enrollmentsTable,
  flagsTable,
  groupMembersTable,
  groupsTable,
  instructorNotesTable,
  questionsTable,
  ratingsTable,
  roundsTable,
  submissionsTable,
  usersTable,
} from "@db/schema.js";
import { and, asc, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { MIN_PEERS_FOR_ANONYMITY } from "../config.ts";
import { displayName, listCourseStudents } from "../lib/course-members.ts";
import { groupSignals, median } from "../lib/insights.ts";
import { Router, type Request } from "express";
import {
  authenticate,
  requireCourseRole,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

// ห้ามส่ง evaluator_id / submission id ของคนอื่นให้นักศึกษา
const router = Router();

function httpError(status: number, message: string) {
  const err: any = new Error(message);
  err.statusCode = status;
  return err;
}

const isReleased = (at: Date | null, now: Date) => at !== null && at <= now;

// ความเห็นต้องไม่เรียงตามคนเขียน
function shuffle<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const MAX_NOTE_LENGTH = 2000;

// ฟีดแบ็กจากอาจารย์ถึงนักศึกษาในรอบนี้ — ผู้เขียนคืออาจารย์คนล่าสุดที่แก้
async function findNote(roundId: string, studentId: string) {
  const [note] = await dbClient
    .select({
      body: instructorNotesTable.body,
      updatedAt: instructorNotesTable.updatedAt,
      cmuAccount: usersTable.cmuAccount,
      firstnameTh: usersTable.firstnameTh,
      lastnameTh: usersTable.lastnameTh,
      firstnameEn: usersTable.firstnameEn,
      lastnameEn: usersTable.lastnameEn,
    })
    .from(instructorNotesTable)
    .innerJoin(usersTable, eq(usersTable.id, instructorNotesTable.authorId))
    .where(and(eq(instructorNotesTable.roundId, roundId), eq(instructorNotesTable.studentId, studentId)));
  return note ? { body: note.body, updatedAt: note.updatedAt, authorName: displayName(note) } : null;
}

// คะแนนรวม = เฉลี่ยของคะแนนรายมิติ, gap = ตัวเอง − เพื่อน (บวก = ให้ตัวเองสูงกว่า)
function overallOf(scores: { peerAverage: number | null; selfScore: number | null }[]) {
  const mean = (xs: (number | null)[]) => {
    const ys = xs.filter((x): x is number => x !== null);
    return ys.length ? round1(ys.reduce((a, b) => a + b, 0) / ys.length) : null;
  };
  const peerAverage = mean(scores.map((s) => s.peerAverage));
  const selfAverage = mean(scores.map((s) => s.selfScore));
  return {
    peerAverage,
    selfAverage,
    gap: peerAverage !== null && selfAverage !== null ? round1(selfAverage - peerAverage) : null,
  };
}

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

      // evaluatorId ใช้นับคนใน server เท่านั้น ห้ามส่งออก
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
      const peerCount = new Set(received.map((r) => r.evaluatorId)).size;
      // ผู้ประเมินน้อยเกินไป → ไม่ส่งทั้งคะแนนและความเห็น (กันรู้ตัวคนเขียน)
      const withheld = (scoresReleased || feedbackReleased) && peerCount < MIN_PEERS_FOR_ANONYMITY;

      let scores = null;
      if (scoresReleased && !withheld) {
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

      const comments = feedbackReleased && !withheld
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
          peerCount,
          withheldReason: withheld ? "ผู้ประเมินไม่พอสำหรับแสดงผลแบบไม่ระบุชื่อ" : null,
          minPeers: MIN_PEERS_FOR_ANONYMITY,
          scores,
          overall: scores ? overallOf(scores) : null,
          comments,
          // มาจากอาจารย์ ไม่ใช่เพื่อน จึงไม่ติดกฎผู้ประเมินขั้นต่ำ — เผยแพร่พร้อมความเห็นจากเพื่อน
          instructorNote: feedbackReleased ? await findNote(round.id, userId) : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

type ReceivedRow = {
  evaluatorId: string;
  evaluateeId: string;
  groupId: string;
  questionId: string;
  score: number | null;
  comment: string | null;
};

async function roundRatings(roundId: string): Promise<ReceivedRow[]> {
  return dbClient
    .select({
      evaluatorId: submissionsTable.evaluatorId,
      evaluateeId: ratingsTable.evaluateeId,
      groupId: submissionsTable.groupId,
      questionId: ratingsTable.questionId,
      score: ratingsTable.score,
      comment: ratingsTable.comment,
    })
    .from(ratingsTable)
    .innerJoin(submissionsTable, eq(submissionsTable.id, ratingsTable.submissionId))
    .where(and(eq(submissionsTable.roundId, roundId), eq(submissionsTable.status, "submitted")));
}

const average = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

router.get(
  "/rounds/:roundId/overview",
  authenticate,
  requireCourseRole("instructor", courseIdOfRound),
  async (req: AuthedRequest, res, next) => {
    try {
      const round = await findRound(String(req.params.roundId));
      const [questions, students, submissions, ratings, groups, ignoredFlags, notes] = await Promise.all([
        dbClient.select().from(questionsTable).orderBy(asc(questionsTable.orderNo)),
        listCourseStudents(round.courseId),
        dbClient
          .select({
            evaluatorId: submissionsTable.evaluatorId,
            groupId: submissionsTable.groupId,
            status: submissionsTable.status,
            submittedAt: submissionsTable.submittedAt,
          })
          .from(submissionsTable)
          .where(eq(submissionsTable.roundId, round.id)),
        roundRatings(round.id),
        dbClient
          .select({ id: groupsTable.id, name: groupsTable.name })
          .from(groupsTable)
          .where(eq(groupsTable.courseId, round.courseId))
          .orderBy(asc(groupsTable.createdAt)),
        dbClient
          .select({ evaluatorId: submissionsTable.evaluatorId, evaluateeId: flagsTable.evaluateeId })
          .from(flagsTable)
          .innerJoin(submissionsTable, eq(submissionsTable.id, flagsTable.submissionId))
          .where(and(eq(submissionsTable.roundId, round.id), eq(flagsTable.studentAction, "ignored"))),
        dbClient
          .select({ studentId: instructorNotesTable.studentId })
          .from(instructorNotesTable)
          .where(eq(instructorNotesTable.roundId, round.id)),
      ]);
      const noted = new Set(notes.map((n) => n.studentId));
      const ratingQuestions = questions.filter((q) => q.type === "rating");

      const rows = students.map((s) => {
        const own = submissions.find((x) => x.evaluatorId === s.id);
        const peer = ratings.filter((r) => r.evaluateeId === s.id && r.evaluatorId !== s.id);
        const groupId = own?.groupId ?? peer[0]?.groupId ?? s.group?.id ?? null;
        const scores = ratingQuestions.map((q) => ({
          questionId: q.id,
          peerAverage: average(peer.filter((r) => r.questionId === q.id && r.score !== null).map((r) => r.score!)),
          selfScore:
            ratings.find((r) => r.evaluatorId === s.id && r.evaluateeId === s.id && r.questionId === q.id)?.score ??
            null,
        }));
        // เฉลี่ยคะแนนจากเพื่อนเฉพาะมิติด้านงาน / ด้านทีม
        const focusAverage = (focus: "task" | "team") =>
          average(
            scores.flatMap((x, i) =>
              ratingQuestions[i].focus === focus && x.peerAverage !== null ? [x.peerAverage] : []
            )
          );
        return {
          student: { id: s.id, studentId: s.studentId, name: s.name },
          groupId,
          submission: own ? { status: own.status, submittedAt: own.submittedAt } : null,
          peerCount: new Set(peer.map((r) => r.evaluatorId)).size,
          scores,
          overall: overallOf(scores),
          focus: { task: focusAverage("task"), team: focusAverage("team") },
          hasNote: noted.has(s.id),
        };
      });

      const ratingIds = new Set(ratingQuestions.map((q) => q.id));
      const scores = ratings.flatMap((r) =>
        r.score !== null && ratingIds.has(r.questionId) ? [{ ...r, score: r.score }] : []
      );
      // ความเห็นถึงตัวเองมีแต่อาจารย์เห็น ไม่นับเป็นข้อความถึงเพื่อน
      const ignoredWarnings = new Map<string, number>();
      for (const f of ignoredFlags)
        if (f.evaluateeId !== f.evaluatorId)
          ignoredWarnings.set(f.evaluatorId, (ignoredWarnings.get(f.evaluatorId) ?? 0) + 1);
      const closed = new Date() >= round.closesAt;
      const defined = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);

      res.json({
        msg: "Fetch round overview successfully",
        data: {
          round: {
            id: round.id,
            courseId: round.courseId,
            sequenceNo: round.sequenceNo,
            opensAt: round.opensAt,
            closesAt: round.closesAt,
            scaleMin: round.scaleMin,
            scaleMax: round.scaleMax,
            scoresReleasedAt: round.scoresReleasedAt,
            feedbackReleasedAt: round.feedbackReleasedAt,
          },
          questions: ratingQuestions.map((q) => ({ id: q.id, orderNo: q.orderNo, prompt: q.prompt, focus: q.focus })),
          // ค่ากลางของทั้งวิชาในรอบนี้ — เส้นแบ่งช่องของแผนภาพทีม
          section: {
            selfMedian: median(defined(rows.map((r) => r.overall.selfAverage))),
            peerMedian: median(defined(rows.map((r) => r.overall.peerAverage))),
            taskMedian: median(defined(rows.map((r) => r.focus.task))),
            teamMedian: median(defined(rows.map((r) => r.focus.team))),
          },
          groups: [
            ...groups.map((g) => {
              const members = rows.filter((r) => r.groupId === g.id);
              return {
                id: g.id,
                name: g.name,
                rows: members,
                signals: groupSignals({
                  members,
                  scores,
                  ignoredWarnings,
                  closed,
                  minPeers: MIN_PEERS_FOR_ANONYMITY,
                }),
              };
            }),
            {
              id: null,
              name: "ยังไม่มีกลุ่ม",
              rows: rows.filter((r) => !r.groupId),
              signals: { received: [], givers: [] },
            },
          ].filter((g) => g.rows.length > 0),
          minPeers: MIN_PEERS_FOR_ANONYMITY,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/rounds/:roundId/students/:studentId",
  authenticate,
  requireCourseRole("instructor", courseIdOfRound),
  async (req: AuthedRequest, res, next) => {
    try {
      const round = await findRound(String(req.params.roundId));
      const studentId = String(req.params.studentId);
      const students = await listCourseStudents(round.courseId);
      const student = students.find((s) => s.id === studentId);
      if (!student) throw httpError(404, "ไม่พบนักศึกษาคนนี้ในวิชา");

      const questions = await dbClient.select().from(questionsTable).orderBy(asc(questionsTable.orderNo));
      const received = (await roundRatings(round.id)).filter((r) => r.evaluateeId === studentId);
      const names = new Map(students.map((s) => [s.id, s.name]));

      const evaluatorIds = [...new Set(received.map((r) => r.evaluatorId))].sort((a, b) =>
        a === studentId ? -1 : b === studentId ? 1 : 0
      );
      const flags = await dbClient
        .select({
          evaluatorId: submissionsTable.evaluatorId,
          evaluateeId: flagsTable.evaluateeId,
          questionId: flagsTable.questionId,
          category: flagsTable.category,
          severity: flagsTable.severity,
          studentAction: flagsTable.studentAction,
          createdAt: flagsTable.createdAt,
        })
        .from(flagsTable)
        .innerJoin(submissionsTable, eq(submissionsTable.id, flagsTable.submissionId))
        .where(
          and(
            eq(submissionsTable.roundId, round.id),
            or(eq(submissionsTable.evaluatorId, studentId), eq(flagsTable.evaluateeId, studentId))
          )
        )
        .orderBy(asc(flagsTable.createdAt));

      const written = flags.filter((f) => f.evaluatorId === studentId);
      const questionNo = new Map(questions.map((q) => [q.id, q.orderNo]));
      const count = (action: string) => written.filter((f) => f.studentAction === action).length;
      const writtenFlags = {
        total: written.length,
        edited: count("edited"),
        ignored: count("ignored"),
        pending: count("pending"),
        items: written.map((f) => ({
          questionNo: questionNo.get(f.questionId) ?? null,
          evaluateeName: f.evaluateeId ? (names.get(f.evaluateeId) ?? null) : null,
          isSelf: f.evaluateeId === studentId,
          category: f.category,
          severity: f.severity,
          studentAction: f.studentAction,
        })),
      };

      const evaluations = evaluatorIds.map((id) => {
        const rows = received.filter((r) => r.evaluatorId === id);
        return {
          evaluator: { id, name: names.get(id) ?? "(ไม่อยู่ในวิชาแล้ว)", isSelf: id === studentId },
          answers: questions.map((q) => {
            const r = rows.find((x) => x.questionId === q.id);
            const ignored = flags.find(
              (f) =>
                f.evaluatorId === id &&
                f.evaluateeId === studentId &&
                f.questionId === q.id &&
                f.studentAction === "ignored"
            );
            return {
              questionId: q.id,
              score: r?.score ?? null,
              comment: r?.comment ?? null,
              ignoredWarning: ignored?.category ?? null,
            };
          }),
        };
      });

      res.json({
        msg: "Fetch student feedback successfully",
        data: {
          student: { id: student.id, studentId: student.studentId, name: student.name, group: student.group },
          questions: questions.map((q) => ({ id: q.id, orderNo: q.orderNo, type: q.type, prompt: q.prompt })),
          scale: { min: round.scaleMin, max: round.scaleMax },
          evaluations,
          writtenFlags,
          note: await findNote(round.id, studentId),
          canWriteNote: new Date() >= round.closesAt,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ข้อความว่าง = ลบ
router.put(
  "/rounds/:roundId/students/:studentId/note",
  authenticate,
  requireCourseRole("instructor", courseIdOfRound),
  async (req: AuthedRequest, res, next) => {
    try {
      const round = await findRound(String(req.params.roundId));
      const studentId = String(req.params.studentId);
      if (new Date() < round.closesAt) throw new Error("เขียนฟีดแบ็กได้หลังรอบปิดรับ");
      const students = await listCourseStudents(round.courseId);
      if (!students.some((s) => s.id === studentId)) throw httpError(404, "ไม่พบนักศึกษาคนนี้ในวิชา");

      const body = String(req.body?.body ?? "").trim();
      if (body.length > MAX_NOTE_LENGTH) throw new Error(`ฟีดแบ็กยาวเกิน ${MAX_NOTE_LENGTH} ตัวอักษร`);

      if (!body)
        await dbClient
          .delete(instructorNotesTable)
          .where(and(eq(instructorNotesTable.roundId, round.id), eq(instructorNotesTable.studentId, studentId)));
      else
        await dbClient
          .insert(instructorNotesTable)
          .values({ roundId: round.id, studentId, authorId: req.user!.id, body })
          .onConflictDoUpdate({
            target: [instructorNotesTable.roundId, instructorNotesTable.studentId],
            set: { body, authorId: req.user!.id, updatedAt: new Date() },
          });

      res.json({ msg: "Save instructor note successfully", data: await findNote(round.id, studentId) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
