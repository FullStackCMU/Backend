import { dbClient } from "@db/client.js";
import {
  groupMembersTable,
  groupsTable,
  roundsTable,
  submissionsTable,
  usersTable,
} from "@db/schema.js";
import { and, asc, count, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { listCourseStudents, personColumns, toPerson } from "../lib/course-members.ts";
import {
  authenticate,
  requireCourseRole,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

const MAX_GROUP_SIZE = 50;
const MAX_CONTRACT_LENGTH = 5000;

async function listGroups(courseId: string, onlyGroupId?: string) {
  const groups = await dbClient
    .select({
      id: groupsTable.id,
      courseId: groupsTable.courseId,
      name: groupsTable.name,
      maxMembers: groupsTable.maxMembers,
      contractText: groupsTable.contractText,
      createdAt: groupsTable.createdAt,
    })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.courseId, courseId),
        onlyGroupId ? eq(groupsTable.id, onlyGroupId) : undefined
      )
    )
    .orderBy(asc(groupsTable.createdAt), asc(groupsTable.name));

  const members = await dbClient
    .select({
      ...personColumns,
      groupId: groupMembersTable.groupId,
      joinedAt: groupMembersTable.joinedAt,
      contractAcceptedAt: groupMembersTable.contractAcceptedAt,
    })
    .from(groupMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, groupMembersTable.userId))
    .where(
      and(
        eq(groupMembersTable.courseId, courseId),
        isNull(groupMembersTable.leftAt)
      )
    )
    .orderBy(asc(groupMembersTable.joinedAt));

  return groups.map((g) => ({
    ...g,
    members: members
      .filter((m) => m.groupId === g.id)
      .map((m) => ({
        ...toPerson(m),
        joinedAt: m.joinedAt,
        contractAcceptedAt: m.contractAcceptedAt,
      })),
  }));
}

// ตรวจค่าที่แก้ได้ของกลุ่ม — undefined = ไม่ได้ส่งมา (ไม่แก้)
function parseGroupInput(body: Record<string, unknown>) {
  const out: { name?: string; maxMembers?: number | null; contractText?: string | null } = {};

  if (body.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("กรุณากรอกชื่อกลุ่ม");
    if (name.length > 100) throw new Error("ชื่อกลุ่มยาวเกิน 100 ตัวอักษร");
    out.name = name;
  }

  if (body.maxMembers !== undefined) {
    if (body.maxMembers === null || body.maxMembers === "") out.maxMembers = null;
    else {
      const n = Number(body.maxMembers);
      if (!Number.isInteger(n) || n < 1 || n > MAX_GROUP_SIZE)
        throw new Error(`จำนวนสมาชิกสูงสุดต้องเป็น 1–${MAX_GROUP_SIZE} คน หรือเว้นว่างถ้าไม่จำกัด`);
      out.maxMembers = n;
    }
  }

  if (body.contractText !== undefined) {
    const text = String(body.contractText ?? "").trim();
    if (text.length > MAX_CONTRACT_LENGTH)
      throw new Error(`ข้อตกลงกลุ่มยาวเกิน ${MAX_CONTRACT_LENGTH} ตัวอักษร`);
    out.contractText = text || null;
  }

  return out;
}

async function assertUniqueName(courseId: string, name: string, exceptGroupId?: string) {
  const [dup] = await dbClient
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.courseId, courseId),
        sql`lower(${groupsTable.name}) = lower(${name})`,
        exceptGroupId ? ne(groupsTable.id, exceptGroupId) : undefined
      )
    );
  if (dup) throw new Error("มีกลุ่มชื่อนี้ในวิชานี้แล้ว");
}

async function courseIdOfGroup(req: Request) {
  const [group] = await dbClient
    .select({ courseId: groupsTable.courseId })
    .from(groupsTable)
    .where(eq(groupsTable.id, String(req.params.groupId)));
  if (!group) {
    const err: any = new Error("ไม่พบกลุ่มนี้");
    err.statusCode = 404;
    throw err;
  }
  return group.courseId;
}

// GET /groups?courseId= — อาจารย์ดูทุกกลุ่ม + นักศึกษาที่ยังไม่มีกลุ่ม
router.get(
  "/",
  authenticate,
  requireCourseRole("instructor"),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const [groups, students] = await Promise.all([
        listGroups(courseId),
        listCourseStudents(courseId),
      ]);
      res.json({
        msg: "Fetch groups successfully",
        data: {
          groups,
          unassigned: students.filter((s) => !s.group).map(({ group: _, ...s }) => s),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /groups/my?courseId= — นักศึกษาดูกลุ่มปัจจุบันของตัวเอง (null = ยังไม่มีกลุ่ม)
router.get(
  "/my",
  authenticate,
  requireCourseRole("student"),
  async (req: AuthedRequest, res, next) => {
    try {
      const [membership] = await dbClient
        .select({ groupId: groupMembersTable.groupId })
        .from(groupMembersTable)
        .where(
          and(
            eq(groupMembersTable.courseId, req.courseId!),
            eq(groupMembersTable.userId, req.user!.id),
            isNull(groupMembersTable.leftAt)
          )
        );
      const [group] = membership
        ? await listGroups(req.courseId!, membership.groupId)
        : [];
      res.json({ msg: "Fetch my group successfully", data: group ?? null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /groups { courseId, name, maxMembers } — อาจารย์สร้างกลุ่ม (นักศึกษาเข้ากลุ่มเอง)
router.post(
  "/",
  authenticate,
  requireCourseRole("instructor"),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const input = parseGroupInput({
        name: req.body.name ?? "",
        maxMembers: req.body.maxMembers ?? null,
      });
      await assertUniqueName(courseId, input.name!);

      const [created] = await dbClient
        .insert(groupsTable)
        .values({ courseId, name: input.name!, maxMembers: input.maxMembers })
        .returning({ id: groupsTable.id });

      const [group] = await listGroups(courseId, created.id);
      res.json({ msg: "Insert group successfully", data: group });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /groups/:groupId { name?, maxMembers?, contractText? } — อาจารย์แก้กลุ่ม / ข้อตกลงกลุ่ม
router.patch(
  "/:groupId",
  authenticate,
  requireCourseRole("instructor", courseIdOfGroup),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const groupId = String(req.params.groupId);
      const input = parseGroupInput(req.body ?? {});
      if (Object.keys(input).length === 0) throw new Error("ไม่มีข้อมูลที่ต้องแก้ไข");

      if (input.name !== undefined) await assertUniqueName(courseId, input.name, groupId);

      const [current] = await listGroups(courseId, groupId);
      if (input.maxMembers != null && current.members.length > input.maxMembers)
        throw new Error(
          `กลุ่มนี้มีสมาชิก ${current.members.length} คนแล้ว ตั้งจำนวนสูงสุดให้น้อยกว่านี้ไม่ได้`
        );

      // ข้อตกลงเปลี่ยน → ทุกคนในกลุ่มต้องยอมรับฉบับใหม่ (ล้าง contract_accepted_at)
      const contractChanged =
        input.contractText !== undefined && input.contractText !== current.contractText;

      await dbClient.transaction(async (tx) => {
        await tx.update(groupsTable).set(input).where(eq(groupsTable.id, groupId));
        if (contractChanged)
          await tx
            .update(groupMembersTable)
            .set({ contractAcceptedAt: null })
            .where(eq(groupMembersTable.groupId, groupId));
      });

      const [group] = await listGroups(courseId, groupId);
      res.json({ msg: "Update group successfully", data: group });
    } catch (err) {
      next(err);
    }
  }
);

// ───────────── นักศึกษา: เลือกกลุ่มเอง ─────────────

type Tx = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

function httpError(status: number, message: string) {
  const err: any = new Error(message);
  err.statusCode = status;
  return err;
}

async function findActiveMembership(db: Tx | typeof dbClient, courseId: string, userId: string) {
  const [membership] = await db
    .select({ id: groupMembersTable.id, groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.courseId, courseId),
        eq(groupMembersTable.userId, userId),
        isNull(groupMembersTable.leftAt)
      )
    );
  return membership;
}

// ห้ามเข้า/ออกกลุ่มระหว่างรอบที่เปิดรับ ถ้ามี submission ในรอบนั้นแล้ว (submission ผูกกับกลุ่ม)
async function assertTeamChangeAllowed(db: Tx | typeof dbClient, courseId: string, userId: string) {
  const now = new Date();
  const [locked] = await db
    .select({ sequenceNo: roundsTable.sequenceNo })
    .from(submissionsTable)
    .innerJoin(roundsTable, eq(roundsTable.id, submissionsTable.roundId))
    .where(
      and(
        eq(roundsTable.courseId, courseId),
        eq(submissionsTable.evaluatorId, userId),
        lte(roundsTable.opensAt, now),
        gt(roundsTable.closesAt, now)
      )
    )
    .limit(1);
  if (locked)
    throw httpError(
      409,
      `คุณเริ่มทำแบบประเมินรอบที่ ${locked.sequenceNo} แล้ว เปลี่ยนกลุ่มได้หลังรอบนี้ปิดรับ`
    );
}

// GET /groups/available?courseId= — นักศึกษาดูกลุ่มทั้งหมดเพื่อเลือกเข้า (ไม่แสดงรหัส/อีเมลของคนอื่น)
router.get(
  "/available",
  authenticate,
  requireCourseRole("student"),
  async (req: AuthedRequest, res, next) => {
    try {
      const groups = await listGroups(req.courseId!);
      res.json({
        msg: "Fetch groups successfully",
        data: groups.map((g) => ({
          id: g.id,
          name: g.name,
          maxMembers: g.maxMembers,
          contractText: g.contractText,
          members: g.members.map((m) => ({ id: m.id, name: m.name })),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /groups/:groupId/join — นักศึกษาเข้ากลุ่ม (ต้องยังไม่มีกลุ่ม และกลุ่มยังไม่เต็ม)
router.post(
  "/:groupId/join",
  authenticate,
  requireCourseRole("student", courseIdOfGroup),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const userId = req.user!.id;
      const groupId = String(req.params.groupId);

      await dbClient.transaction(async (tx) => {
        // ล็อกแถวกลุ่ม กันสองคนเข้าที่นั่งสุดท้ายพร้อมกัน
        const [group] = await tx
          .select({ maxMembers: groupsTable.maxMembers })
          .from(groupsTable)
          .where(eq(groupsTable.id, groupId))
          .for("update");

        if (await findActiveMembership(tx, courseId, userId))
          throw httpError(409, "คุณมีกลุ่มในวิชานี้แล้ว ออกจากกลุ่มเดิมก่อน");
        await assertTeamChangeAllowed(tx, courseId, userId);

        if (group.maxMembers !== null) {
          const [{ members }] = await tx
            .select({ members: count() })
            .from(groupMembersTable)
            .where(and(eq(groupMembersTable.groupId, groupId), isNull(groupMembersTable.leftAt)));
          if (members >= group.maxMembers) throw httpError(409, "กลุ่มนี้เต็มแล้ว");
        }

        await tx.insert(groupMembersTable).values({ groupId, courseId, userId });
      });

      const [group] = await listGroups(courseId, groupId);
      res.json({ msg: "Join group successfully", data: group });
    } catch (err) {
      next(err);
    }
  }
);

// POST /groups/leave { courseId } — นักศึกษาออกจากกลุ่มปัจจุบัน (ตั้ง left_at เก็บประวัติไว้)
router.post(
  "/leave",
  authenticate,
  requireCourseRole("student"),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const userId = req.user!.id;

      await dbClient.transaction(async (tx) => {
        const membership = await findActiveMembership(tx, courseId, userId);
        if (!membership) throw httpError(409, "คุณยังไม่มีกลุ่มในวิชานี้");
        await assertTeamChangeAllowed(tx, courseId, userId);
        await tx
          .update(groupMembersTable)
          .set({ leftAt: new Date() })
          .where(eq(groupMembersTable.id, membership.id));
      });

      res.json({ msg: "Leave group successfully", data: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /groups/:groupId/accept-contract — สมาชิกยอมรับข้อตกลงกลุ่ม (ฉบับปัจจุบัน)
router.post(
  "/:groupId/accept-contract",
  authenticate,
  requireCourseRole("student", courseIdOfGroup),
  async (req: AuthedRequest, res, next) => {
    try {
      const courseId = req.courseId!;
      const groupId = String(req.params.groupId);
      const membership = await findActiveMembership(dbClient, courseId, req.user!.id);
      if (!membership || membership.groupId !== groupId)
        throw httpError(403, "คุณไม่ได้อยู่ในกลุ่มนี้");

      const [group] = await listGroups(courseId, groupId);
      if (!group.contractText) throw new Error("กลุ่มนี้ยังไม่มีข้อตกลง");

      await dbClient
        .update(groupMembersTable)
        .set({ contractAcceptedAt: new Date() })
        .where(
          and(eq(groupMembersTable.id, membership.id), isNull(groupMembersTable.contractAcceptedAt))
        );

      const [updated] = await listGroups(courseId, groupId);
      res.json({ msg: "Accept contract successfully", data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
