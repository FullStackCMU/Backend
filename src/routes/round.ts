import { dbClient } from "@db/client.js";
import { groupMembersTable, roundsTable, submissionsTable } from "@db/schema.js";
import { and, asc, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { Router, type Request } from "express";
import {
  authenticate,
  requireCourseRole,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

const DAY = 24 * 60 * 60 * 1000;
const MAX_ROUNDS_PER_BATCH = 20;
const MAX_INTERVAL_WEEKS = 8;
// ยอมให้เวลาเปิดรอบแรกย้อนหลังได้นิดหน่อย (เวลาที่เลือกในฟอร์มกับเวลาที่กดส่งห่างกัน)
const PAST_TOLERANCE = 5 * 60 * 1000;
// วันปิดรับคิดตามเวลาไทย (Asia/Bangkok = UTC+7 ไม่มี DST) ไม่ขึ้นกับ timezone ของ server
// Frontend ใช้สูตรเดียวกันใน src/lib/date.ts (endOfThaiDay)
const THAI_OFFSET = 7 * 60 * 60 * 1000;

/** 23:59 เวลาไทยของวันที่ date + addDays (นับตามวันที่เวลาไทย) */
function endOfThaiDay(date: Date, addDays: number) {
  const local = new Date(date.getTime() + THAI_OFFSET);
  local.setUTCDate(local.getUTCDate() + addDays);
  local.setUTCHours(23, 59, 0, 0);
  return new Date(local.getTime() - THAI_OFFSET);
}

type RoundRow = typeof roundsTable.$inferSelect;

function httpError(status: number, message: string) {
  const err: any = new Error(message);
  err.statusCode = status;
  return err;
}

function parseDate(value: unknown, label: string) {
  const d = new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) throw new Error(`${label}ไม่ถูกต้อง`);
  return d;
}

function parseIntInRange(value: unknown, min: number, max: number, message: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(message);
  return n;
}

// /rounds/:roundId → หารอบ (และ courseId) เพื่อเช็คสิทธิ์ในวิชานั้น
async function findRound(roundId: string) {
  const [round] = await dbClient.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) throw httpError(404, "ไม่พบรอบประเมินนี้");
  return round;
}
const courseIdOfRound = async (req: Request) =>
  (await findRound(String(req.params.roundId))).courseId;

// นักศึกษาที่มีกลุ่มในวิชาตอนนี้ (left_at เป็น null) — ใช้นับความคืบหน้า
const activeMembers = (courseId: string) =>
  dbClient
    .select({ userId: groupMembersTable.userId })
    .from(groupMembersTable)
    .where(and(eq(groupMembersTable.courseId, courseId), isNull(groupMembersTable.leftAt)));

// รอบในวิชา — อาจารย์ได้ submittedCount/studentCount (นับเฉพาะคนที่มีกลุ่ม)
// นักศึกษา (viewerId) ได้ mySubmission ของตัวเองในแต่ละรอบ
async function listRounds(courseId: string, viewer: { role: "instructor" } | { role: "student"; userId: string }) {
  const rounds = await dbClient
    .select()
    .from(roundsTable)
    .where(eq(roundsTable.courseId, courseId))
    .orderBy(asc(roundsTable.sequenceNo));
  if (rounds.length === 0) return rounds;
  const roundIds = rounds.map((r) => r.id);

  if (viewer.role === "student") {
    const mine = await dbClient
      .select({
        roundId: submissionsTable.roundId,
        status: submissionsTable.status,
        submittedAt: submissionsTable.submittedAt,
      })
      .from(submissionsTable)
      .where(and(inArray(submissionsTable.roundId, roundIds), eq(submissionsTable.evaluatorId, viewer.userId)));
    return rounds.map((r) => {
      const s = mine.find((m) => m.roundId === r.id);
      return { ...r, mySubmission: s ? { status: s.status, submittedAt: s.submittedAt } : null };
    });
  }

  const [{ studentCount }] = await dbClient
    .select({ studentCount: count() })
    .from(activeMembers(courseId).as("active"));

  const submitted = await dbClient
    .select({ roundId: submissionsTable.roundId, count: count() })
    .from(submissionsTable)
    .where(
      and(
        inArray(submissionsTable.roundId, roundIds),
        eq(submissionsTable.status, "submitted"),
        inArray(submissionsTable.evaluatorId, activeMembers(courseId))
      )
    )
    .groupBy(submissionsTable.roundId);

  return rounds.map((r) => ({
    ...r,
    submittedCount: submitted.find((s) => s.roundId === r.id)?.count ?? 0,
    studentCount,
  }));
}

const INSTRUCTOR = { role: "instructor" } as const;

// GET /rounds?courseId= — รอบทั้งหมดของวิชา (อาจารย์ได้ความคืบหน้าการส่งด้วย)
router.get(
  "/",
  authenticate,
  requireCourseRole(["instructor", "student"]),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await listRounds(
        req.courseId!,
        req.courseRole === "instructor" ? INSTRUCTOR : { role: "student", userId: req.user!.id }
      );
      res.json({ msg: "Fetch rounds successfully", data });
    } catch (err) {
      next(err);
    }
  }
);

// POST /rounds/generate — สร้างรอบต่อจากรอบสุดท้ายตามตารางเวลา
// { courseId, count, firstOpensAt, openDays, intervalWeeks, scaleMin, scaleMax }
// รอบที่ k (เริ่ม 0): เปิด = firstOpensAt + k × intervalWeeks สัปดาห์
// ปิด = 23:59 (เวลาไทย) ของวันที่ openDays นับวันเปิดเป็นวันที่ 1
router.post(
  "/generate",
  authenticate,
  requireCourseRole("instructor"),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const total = parseIntInRange(req.body.count, 1, MAX_ROUNDS_PER_BATCH, `จำนวนรอบต้องเป็น 1–${MAX_ROUNDS_PER_BATCH}`);
      const intervalWeeks = parseIntInRange(req.body.intervalWeeks, 1, MAX_INTERVAL_WEEKS, `ความถี่ต้องเป็นทุก 1–${MAX_INTERVAL_WEEKS} สัปดาห์`);
      const openDays = parseIntInRange(
        req.body.openDays,
        1,
        intervalWeeks * 7,
        `ระยะเปิดรับต้องเป็น 1–${intervalWeeks * 7} วัน (ไม่เกินระยะห่างระหว่างรอบ)`
      );
      const scaleMin = parseIntInRange(req.body.scaleMin, 0, 1, "คะแนนต่ำสุดต้องเป็น 0 หรือ 1");
      const scaleMax = parseIntInRange(req.body.scaleMax, 3, 10, "คะแนนสูงสุดต้องเป็น 3–10");
      const firstOpensAt = parseDate(req.body.firstOpensAt, "วันเปิดรอบแรก");
      if (firstOpensAt.getTime() < Date.now() - PAST_TOLERANCE)
        throw new Error("วันเปิดรอบแรกต้องเป็นเวลาในอนาคต");

      const [last] = await dbClient
        .select()
        .from(roundsTable)
        .where(eq(roundsTable.courseId, courseId))
        .orderBy(desc(roundsTable.sequenceNo))
        .limit(1);
      if (last && firstOpensAt < last.closesAt)
        throw new Error(`รอบแรกต้องเปิดหลังรอบที่ ${last.sequenceNo} ปิดรับ`);

      const startSeq = (last?.sequenceNo ?? 0) + 1;
      const values = Array.from({ length: total }, (_, k) => {
        const opensAt = new Date(firstOpensAt.getTime() + k * intervalWeeks * 7 * DAY);
        return {
          courseId,
          sequenceNo: startSeq + k,
          opensAt,
          closesAt: endOfThaiDay(opensAt, openDays - 1),
          scaleMin,
          scaleMax,
        };
      });

      await dbClient.insert(roundsTable).values(values);
      const data = await listRounds(courseId, INSTRUCTOR);
      res.json({ msg: "Generate rounds successfully", data });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /rounds/:roundId { opensAt?, closesAt? } — แก้วันเปิด/ปิด
// ต้องไม่ทับซ้อนรอบก่อนหน้า/ถัดไป (ลำดับเวลาตรงกับเลขรอบเสมอ)
router.patch(
  "/:roundId",
  authenticate,
  requireCourseRole("instructor", courseIdOfRound),
  async (req: AuthedRequest, res, next) => {
    try {
      const round = await findRound(String(req.params.roundId));
      const now = new Date();

      if (round.scoresReleasedAt || round.feedbackReleasedAt)
        throw new Error("รอบนี้เผยแพร่ผลแล้ว ยกเลิกการเผยแพร่ก่อนจึงแก้วันได้");

      const opensAt = req.body.opensAt !== undefined ? parseDate(req.body.opensAt, "วันเปิดรับ") : round.opensAt;
      const closesAt = req.body.closesAt !== undefined ? parseDate(req.body.closesAt, "วันปิดรับ") : round.closesAt;

      if (opensAt.getTime() !== round.opensAt.getTime()) {
        if (round.opensAt <= now) throw new Error("รอบนี้เปิดรับแล้ว แก้วันเปิดไม่ได้");
        if (opensAt.getTime() < now.getTime() - PAST_TOLERANCE)
          throw new Error("วันเปิดรับต้องเป็นเวลาในอนาคต");
      }
      if (closesAt <= opensAt) throw new Error("วันปิดรับต้องอยู่หลังวันเปิดรับ");

      const neighbours = await dbClient
        .select()
        .from(roundsTable)
        .where(
          and(
            eq(roundsTable.courseId, round.courseId),
            inArray(roundsTable.sequenceNo, [round.sequenceNo - 1, round.sequenceNo + 1])
          )
        );
      const prev = neighbours.find((r) => r.sequenceNo === round.sequenceNo - 1);
      const next = neighbours.find((r) => r.sequenceNo === round.sequenceNo + 1);
      if (prev && opensAt < prev.closesAt)
        throw new Error(`ต้องเปิดหลังรอบที่ ${prev.sequenceNo} ปิดรับ`);
      if (next && closesAt > next.opensAt)
        throw new Error(`ต้องปิดก่อนรอบที่ ${next.sequenceNo} เปิดรับ`);

      await dbClient
        .update(roundsTable)
        .set({ opensAt, closesAt })
        .where(eq(roundsTable.id, round.id));

      const data = await listRounds(round.courseId, INSTRUCTOR);
      res.json({ msg: "Update round successfully", data });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /rounds/:roundId — ลบได้เฉพาะรอบที่ยังไม่เปิด แล้วเลื่อนเลขรอบถัดไปขึ้นมา (ไม่ให้เลขรอบขาด)
router.delete(
  "/:roundId",
  authenticate,
  requireCourseRole("instructor", courseIdOfRound),
  async (req: AuthedRequest, res, next) => {
    try {
      const round = await findRound(String(req.params.roundId));
      if (round.opensAt <= new Date()) throw new Error("ลบได้เฉพาะรอบที่ยังไม่เปิดรับ");

      await dbClient.transaction(async (tx) => {
        await tx.delete(roundsTable).where(eq(roundsTable.id, round.id));
        // รอบถัดไปทั้งหมดยังไม่เปิดเช่นกัน (ลำดับเวลาตรงกับเลขรอบ) — เลื่อนทีละรอบจากน้อยไปมาก
        // เพื่อไม่ชน unique (course_id, sequence_no)
        const later: RoundRow[] = await tx
          .select()
          .from(roundsTable)
          .where(and(eq(roundsTable.courseId, round.courseId), gt(roundsTable.sequenceNo, round.sequenceNo)))
          .orderBy(asc(roundsTable.sequenceNo));
        for (const r of later)
          await tx
            .update(roundsTable)
            .set({ sequenceNo: r.sequenceNo - 1 })
            .where(eq(roundsTable.id, r.id));
      });

      const data = await listRounds(round.courseId, INSTRUCTOR);
      res.json({ msg: "Delete round successfully", data });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /rounds/:roundId/release { scores?: boolean, feedback?: boolean }
// true = เผยแพร่ตอนนี้ (ได้เฉพาะรอบที่ปิดรับแล้ว), false = ยกเลิกการเผยแพร่
router.patch(
  "/:roundId/release",
  authenticate,
  requireCourseRole("instructor", courseIdOfRound),
  async (req: AuthedRequest, res, next) => {
    try {
      const round = await findRound(String(req.params.roundId));
      const now = new Date();
      const set: Partial<Pick<RoundRow, "scoresReleasedAt" | "feedbackReleasedAt">> = {};

      for (const [key, column] of [
        ["scores", "scoresReleasedAt"],
        ["feedback", "feedbackReleasedAt"],
      ] as const) {
        const value = req.body?.[key];
        if (value === undefined) continue;
        if (typeof value !== "boolean") throw new Error(`${key} ต้องเป็น true หรือ false`);
        if (value && round.closesAt > now)
          throw new Error("เผยแพร่ได้เฉพาะรอบที่ปิดรับแล้ว");
        // เผยแพร่อยู่แล้วไม่เปลี่ยนเวลาเดิม
        set[column] = value ? (round[column] ?? now) : null;
      }
      if (Object.keys(set).length === 0) throw new Error("ระบุ scores หรือ feedback");

      await dbClient.update(roundsTable).set(set).where(eq(roundsTable.id, round.id));

      const data = await listRounds(round.courseId, INSTRUCTOR);
      res.json({ msg: "Update release successfully", data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
