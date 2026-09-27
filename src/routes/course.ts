import { dbClient } from "@db/client.js";
import {
  coursesTable,
  enrollmentsTable,
  groupMembersTable,
  groupsTable,
  roundsTable,
  usersTable,
} from "@db/schema.js";
import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Router } from "express";
import { displayName, listCourseStudents } from "../lib/course-members.ts";
import {
  authenticate,
  requireCourseRole,
  requireStaff,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

type RoundRow = typeof roundsTable.$inferSelect;

// รอบที่แสดงบนการ์ดวิชา: รอบล่าสุดที่เปิดไปแล้ว ถ้ายังไม่มีเลยใช้รอบถัดไปที่จะเปิด
function pickCurrentRound(rounds: RoundRow[], now: Date) {
  const started = rounds.filter((r) => r.opensAt <= now);
  if (started.length > 0)
    return started.reduce((a, b) => (b.sequenceNo > a.sequenceNo ? b : a));
  if (rounds.length === 0) return null;
  return rounds.reduce((a, b) => (b.sequenceNo < a.sequenceNo ? b : a));
}

// วิชาที่ผู้ใช้มี enrollment + จำนวนนักศึกษา + รอบปัจจุบัน (onlyCourseId = เอาวิชาเดียว)
async function listCourseSummaries(userId: string, onlyCourseId?: string) {
  const courses = await dbClient
    .select({
      id: coursesTable.id,
      courseCode: coursesTable.courseCode,
      title: coursesTable.title,
      section: coursesTable.section,
      semester: coursesTable.semester,
      academicYear: coursesTable.academicYear,
      createdAt: coursesTable.createdAt,
      role: enrollmentsTable.role,
    })
    .from(enrollmentsTable)
    .innerJoin(coursesTable, eq(coursesTable.id, enrollmentsTable.courseId))
    .where(
      and(
        eq(enrollmentsTable.userId, userId),
        onlyCourseId ? eq(coursesTable.id, onlyCourseId) : undefined
      )
    )
    .orderBy(
      desc(coursesTable.academicYear),
      desc(coursesTable.semester),
      asc(coursesTable.courseCode),
      asc(coursesTable.section)
    );

  if (courses.length === 0) return [];
  const courseIds = courses.map((c) => c.id);

  const studentCounts = await dbClient
    .select({ courseId: enrollmentsTable.courseId, count: count() })
    .from(enrollmentsTable)
    .where(
      and(
        inArray(enrollmentsTable.courseId, courseIds),
        eq(enrollmentsTable.role, "student")
      )
    )
    .groupBy(enrollmentsTable.courseId);

  const rounds = await dbClient
    .select()
    .from(roundsTable)
    .where(inArray(roundsTable.courseId, courseIds));

  const instructors = await dbClient
    .select({
      courseId: enrollmentsTable.courseId,
      firstnameTh: usersTable.firstnameTh,
      lastnameTh: usersTable.lastnameTh,
      firstnameEn: usersTable.firstnameEn,
      lastnameEn: usersTable.lastnameEn,
      cmuAccount: usersTable.cmuAccount,
    })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .where(
      and(inArray(enrollmentsTable.courseId, courseIds), eq(enrollmentsTable.role, "instructor"))
    );

  // กลุ่มปัจจุบันของผู้ใช้ในแต่ละวิชา (อาจารย์ไม่มี)
  const myGroups = await dbClient
    .select({ courseId: groupMembersTable.courseId, id: groupsTable.id, name: groupsTable.name })
    .from(groupMembersTable)
    .innerJoin(groupsTable, eq(groupsTable.id, groupMembersTable.groupId))
    .where(
      and(
        inArray(groupMembersTable.courseId, courseIds),
        eq(groupMembersTable.userId, userId),
        isNull(groupMembersTable.leftAt)
      )
    );

  const now = new Date();
  return courses.map((c) => {
    const courseRounds = rounds.filter((r) => r.courseId === c.id);
    const round = pickCurrentRound(courseRounds, now);
    const group = myGroups.find((g) => g.courseId === c.id);
    return {
      ...c,
      instructors: instructors.filter((i) => i.courseId === c.id).map(displayName),
      myGroup: group ? { id: group.id, name: group.name } : null,
      roundCount: courseRounds.length,
      openRoundCount: courseRounds.filter((r) => r.opensAt <= now && now < r.closesAt).length,
      studentCount: studentCounts.find((s) => s.courseId === c.id)?.count ?? 0,
      currentRound: round && {
        id: round.id,
        sequenceNo: round.sequenceNo,
        opensAt: round.opensAt,
        closesAt: round.closesAt,
        scoresReleasedAt: round.scoresReleasedAt,
        feedbackReleasedAt: round.feedbackReleasedAt,
      },
    };
  });
}

// GET /courses — วิชาที่ฉันมี enrollment (ทั้งฐานะอาจารย์และนักศึกษา)
router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const data = await listCourseSummaries(req.user!.id);
    res.json({ msg: "Fetch courses successfully", data });
  } catch (err) {
    next(err);
  }
});

// POST /courses — บุคลากรสร้างวิชา ผู้สร้างได้ enrollment เป็น instructor อัตโนมัติ
router.post(
  "/",
  authenticate,
  requireStaff,
  async (req: AuthedRequest, res, next) => {
    try {
      const courseCode = String(req.body.courseCode ?? "").trim();
      const title = String(req.body.title ?? "").trim();
      const section = String(req.body.section ?? "").trim() || null;
      const semester = Number(req.body.semester);
      const academicYear = Number(req.body.academicYear);

      if (!/^\d{6}$/.test(courseCode))
        throw new Error("รหัสวิชาต้องเป็นตัวเลข 6 หลัก");
      if (!title) throw new Error("กรุณากรอกชื่อวิชา");
      if (section !== null && !/^\d{3}$/.test(section))
        throw new Error("ตอนต้องเป็นตัวเลข 3 หลัก เช่น 001");
      if (![1, 2, 3].includes(semester))
        throw new Error("ภาคการศึกษาไม่ถูกต้อง");
      if (!Number.isInteger(academicYear) || academicYear < 2500 || academicYear > 2700)
        throw new Error("ปีการศึกษาต้องเป็นปี พ.ศ. เช่น 2569");

      // unique index ของ (course_code, section, semester, academic_year) ไม่กันแถวที่ section เป็น null
      // (Postgres ถือว่า null ไม่ซ้ำกัน) จึงเช็คเองก่อน insert
      const [existing] = await dbClient
        .select({ id: coursesTable.id })
        .from(coursesTable)
        .where(
          and(
            eq(coursesTable.courseCode, courseCode),
            section === null
              ? isNull(coursesTable.section)
              : eq(coursesTable.section, section),
            eq(coursesTable.semester, semester),
            eq(coursesTable.academicYear, academicYear)
          )
        );
      if (existing)
        throw new Error("มีวิชานี้ในภาคการศึกษานี้อยู่แล้ว (รหัสวิชา ตอน และภาคซ้ำกัน)");

      const course = await dbClient.transaction(async (tx) => {
        const [created] = await tx
          .insert(coursesTable)
          .values({
            courseCode,
            title,
            section,
            semester,
            academicYear,
            createdBy: req.user!.id,
          })
          .returning();

        await tx.insert(enrollmentsTable).values({
          courseId: created.id,
          userId: req.user!.id,
          role: "instructor",
        });

        return created;
      });

      res.json({
        msg: "Insert course successfully",
        data: {
          ...course,
          role: "instructor",
          instructors: [displayName(req.user!)],
          myGroup: null,
          roundCount: 0,
          openRoundCount: 0,
          studentCount: 0,
          currentRound: null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /courses/:courseId — ข้อมูลวิชาเดียว (อาจารย์หรือนักศึกษาในวิชา)
router.get(
  "/:courseId",
  authenticate,
  requireCourseRole(["instructor", "student"]),
  async (req: AuthedRequest, res, next) => {
    try {
      const [data] = await listCourseSummaries(req.user!.id, req.courseId);
      res.json({ msg: "Fetch course successfully", data });
    } catch (err) {
      next(err);
    }
  }
);

// GET /courses/:courseId/students — รายชื่อนักศึกษา + กลุ่มปัจจุบัน
router.get(
  "/:courseId/students",
  authenticate,
  requireCourseRole("instructor"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await listCourseStudents(req.courseId!);
      res.json({ msg: "Fetch students successfully", data });
    } catch (err) {
      next(err);
    }
  }
);

const MAX_IMPORT_ROWS = 2000;
const STUDENT_ID_RE = /^\d{9}$/;
const CMU_ACCOUNT_RE = /^[a-z0-9._-]+@cmu\.ac\.th$/;

type ImportRow = { line: number; studentId: string; cmuAccount: string; nameTh: string };
type ImportIssue = { line: number; reason: string; kind: "duplicate" | "invalid" };

// ตรวจรูปแบบแต่ละแถว + แถวที่ซ้ำกันเองในไฟล์
function parseImportRows(input: unknown[]) {
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seenAccounts = new Set<string>();
  const seenStudentIds = new Set<string>();

  input.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const line = Number(r.line) || i + 2;
    const studentId = String(r.studentId ?? "").trim();
    const cmuAccount = String(r.cmuAccount ?? "").trim().toLowerCase();
    const nameTh = String(r.nameTh ?? "").trim().replace(/\s+/g, " ");

    let reason = "";
    if (!STUDENT_ID_RE.test(studentId)) reason = "รหัสนักศึกษาต้องเป็นตัวเลข 9 หลัก";
    else if (!CMU_ACCOUNT_RE.test(cmuAccount)) reason = "CMU account ต้องเป็นอีเมล @cmu.ac.th";
    else if (!nameTh) reason = "ไม่มีชื่อ";
    if (reason) {
      issues.push({ line, reason, kind: "invalid" });
      return;
    }

    if (seenAccounts.has(cmuAccount) || seenStudentIds.has(studentId)) {
      issues.push({ line, reason: "ซ้ำกับแถวก่อนหน้าในไฟล์", kind: "duplicate" });
      return;
    }
    seenAccounts.add(cmuAccount);
    seenStudentIds.add(studentId);
    rows.push({ line, studentId, cmuAccount, nameTh });
  });

  return { rows, issues };
}

// POST /courses/:courseId/students/import { rows: [{ line, studentId, cmuAccount, nameTh }] }
// Class Import: สร้าง user ถ้ายังไม่มี (ยังไม่เคย login → first_login_at เป็น null) แล้ว enroll เป็น student
// ตรวจทุกแถวที่นี่ (frontend ตรวจเบื้องต้นเพื่อแสดงตัวอย่างเท่านั้น)
router.post(
  "/:courseId/students/import",
  authenticate,
  requireCourseRole("instructor"),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const input: unknown[] = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (input.length === 0) throw new Error("ไม่พบข้อมูลนักศึกษาในไฟล์");
      if (input.length > MAX_IMPORT_ROWS)
        throw new Error(`นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT_ROWS} แถว`);

      const { rows, issues } = parseImportRows(input);

      const result = await dbClient.transaction(async (tx) => {
        if (rows.length === 0) return { added: 0, created: 0 };

        const existing = await tx
          .select({
            id: usersTable.id,
            cmuAccount: usersTable.cmuAccount,
            studentId: usersTable.studentId,
            accountType: usersTable.accountType,
          })
          .from(usersTable)
          .where(
            or(
              inArray(usersTable.cmuAccount, rows.map((r) => r.cmuAccount)),
              inArray(usersTable.studentId, rows.map((r) => r.studentId))
            )
          );
        const byAccount = new Map(existing.map((u) => [u.cmuAccount, u]));
        const byStudentId = new Map(
          existing.filter((u) => u.studentId).map((u) => [u.studentId!, u])
        );

        const enrolledRows =
          existing.length === 0
            ? []
            : await tx
                .select({ userId: enrollmentsTable.userId })
                .from(enrollmentsTable)
                .where(
                  and(
                    eq(enrollmentsTable.courseId, courseId),
                    inArray(enrollmentsTable.userId, existing.map((u) => u.id))
                  )
                );
        const enrolled = new Set(enrolledRows.map((e) => e.userId));

        const toEnroll: string[] = [];
        const toSetStudentId: { id: string; studentId: string }[] = [];
        const toCreate: (typeof usersTable.$inferInsert)[] = [];

        // เทียบกับข้อมูลในระบบ
        for (const r of rows) {
          const user = byAccount.get(r.cmuAccount);
          const owner = byStudentId.get(r.studentId);
          const invalid = (reason: string) => issues.push({ line: r.line, reason, kind: "invalid" });

          if (user) {
            if (user.accountType === "MISEmpAcc") invalid("บัญชีนี้เป็นบุคลากร ไม่ใช่นักศึกษา");
            else if (user.studentId && user.studentId !== r.studentId)
              invalid(`บัญชีนี้ผูกกับรหัสนักศึกษา ${user.studentId} อยู่แล้ว`);
            else if (!user.studentId && owner)
              invalid(`รหัสนักศึกษานี้ผูกกับบัญชี ${owner.cmuAccount} อยู่แล้ว`);
            else if (enrolled.has(user.id))
              issues.push({ line: r.line, reason: "อยู่ในวิชานี้แล้ว", kind: "duplicate" });
            else {
              toEnroll.push(user.id);
              if (!user.studentId) toSetStudentId.push({ id: user.id, studentId: r.studentId });
            }
          } else if (owner) {
            invalid(`รหัสนักศึกษานี้ผูกกับบัญชี ${owner.cmuAccount} อยู่แล้ว`);
          } else {
            // ชื่อไทยคำแรก = ชื่อ ที่เหลือ = นามสกุล (login ครั้งแรกจะอัปเดตจาก CMU อีกที)
            const [firstnameTh, ...rest] = r.nameTh.split(" ");
            toCreate.push({
              cmuAccount: r.cmuAccount,
              studentId: r.studentId,
              firstnameTh,
              lastnameTh: rest.join(" ") || null,
              accountType: "StdAcc",
            });
          }
        }

        const created =
          toCreate.length === 0
            ? []
            : await tx.insert(usersTable).values(toCreate).returning({ id: usersTable.id });

        for (const u of toSetStudentId)
          await tx
            .update(usersTable)
            .set({ studentId: u.studentId })
            .where(eq(usersTable.id, u.id));

        const userIds = [...toEnroll, ...created.map((u) => u.id)];
        if (userIds.length > 0)
          await tx
            .insert(enrollmentsTable)
            .values(userIds.map((userId) => ({ courseId, userId, role: "student" as const })))
            .onConflictDoNothing();

        return { added: userIds.length, created: created.length };
      });

      issues.sort((a, b) => a.line - b.line);
      res.json({
        msg: "Import students successfully",
        data: {
          ...result,
          duplicate: issues.filter((i) => i.kind === "duplicate").length,
          invalid: issues.filter((i) => i.kind === "invalid").length,
          issues,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
