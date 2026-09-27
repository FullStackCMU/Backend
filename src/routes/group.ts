import { dbClient } from "@db/client.js";
import { groupMembersTable, groupsTable, usersTable } from "@db/schema.js";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
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

// กลุ่มในวิชา + สมาชิกปัจจุบัน (left_at เป็น null) — onlyGroupId = เอากลุ่มเดียว
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

// ชื่อกลุ่มในวิชาเดียวกันห้ามซ้ำ (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
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

// /groups/:groupId → หา courseId จากกลุ่ม เพื่อเช็คสิทธิ์ในวิชานั้น
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

      if (input.maxMembers != null) {
        const [current] = await listGroups(courseId, groupId);
        if (current.members.length > input.maxMembers)
          throw new Error(
            `กลุ่มนี้มีสมาชิก ${current.members.length} คนแล้ว ตั้งจำนวนสูงสุดให้น้อยกว่านี้ไม่ได้`
          );
      }

      await dbClient.update(groupsTable).set(input).where(eq(groupsTable.id, groupId));

      const [group] = await listGroups(courseId, groupId);
      res.json({ msg: "Update group successfully", data: group });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
