import { dbClient } from "@db/client.js";
import { groupMembersTable, groupsTable, usersTable } from "@db/schema.js";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import {
  authenticate,
  requireInstructor,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

type GroupRow = {
  id: string;
  name: string;
  section: string | null;
  courseId: string;
  members: { id: string; name: string; username: string }[];
};

// รวมผลลัพธ์จาก JOIN ให้เป็นกลุ่มพร้อม array สมาชิก
function groupRows(
  rows: {
    groupId: string;
    groupName: string;
    section: string | null;
    courseId: string;
    memberId: string | null;
    memberName: string | null;
    memberUsername: string | null;
  }[]
): GroupRow[] {
  const map: Record<string, GroupRow> = {};
  rows.forEach((row) => {
    if (!map[row.groupId]) {
      map[row.groupId] = {
        id: row.groupId,
        name: row.groupName,
        section: row.section,
        courseId: row.courseId,
        members: [],
      };
    }
    if (row.memberId) {
      map[row.groupId].members.push({
        id: row.memberId,
        name: row.memberName!,
        username: row.memberUsername!,
      });
    }
  });
  return Object.values(map);
}

const groupSelect = {
  groupId: groupsTable.id,
  groupName: groupsTable.name,
  section: groupsTable.section,
  courseId: groupsTable.courseId,
  memberId: usersTable.id,
  memberName: usersTable.name,
  memberUsername: usersTable.username,
};

// POST /groups — อาจารย์สร้างกลุ่ม + ใส่สมาชิก (transaction)
router.post("/", authenticate, requireInstructor, async (req, res, next) => {
  try {
    const name = req.body.name ?? "";
    const courseId = req.body.courseId ?? "";
    const section = req.body.section ?? null;
    const memberIds: string[] = req.body.memberIds ?? [];

    if (!name || !courseId) throw new Error("name and courseId are required");

    const group = await dbClient.transaction(async (tx) => {
      const [newGroup] = await tx
        .insert(groupsTable)
        .values({ name, courseId, section })
        .returning();

      if (memberIds.length > 0) {
        await tx
          .insert(groupMembersTable)
          .values(memberIds.map((userId) => ({ groupId: newGroup.id, userId })));
      }

      return newGroup;
    });

    res.json({ msg: "Insert group successfully", data: group });
  } catch (err) {
    next(err);
  }
});

// GET /groups/my?courseId=... — กลุ่มของฉันในวิชานั้น
router.get("/my", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const courseId = String(req.query.courseId ?? "");
    if (!courseId) throw new Error("courseId is required");

    // หากลุ่มที่ฉันเป็นสมาชิกในวิชานี้ (single query)
    const [mine] = await dbClient
      .select({ groupId: groupMembersTable.groupId })
      .from(groupMembersTable)
      .innerJoin(groupsTable, eq(groupsTable.id, groupMembersTable.groupId))
      .where(
        and(
          eq(groupMembersTable.userId, req.user!.id),
          eq(groupsTable.courseId, courseId)
        )
      );

    if (!mine) return res.json({ msg: "No group found", data: null });

    const rows = await dbClient
      .select(groupSelect)
      .from(groupsTable)
      .leftJoin(
        groupMembersTable,
        eq(groupMembersTable.groupId, groupsTable.id)
      )
      .leftJoin(usersTable, eq(usersTable.id, groupMembersTable.userId))
      .where(eq(groupsTable.id, mine.groupId));

    res.json({ msg: "Fetch my group successfully", data: groupRows(rows)[0] });
  } catch (err) {
    next(err);
  }
});

// GET /groups?courseId=... — กลุ่มทั้งหมด — เฉพาะอาจารย์
// นักศึกษาต้องใช้ /groups/my เท่านั้น กัน roster ข้ามวิชาทั้งระบบรั่ว
router.get("/", authenticate, requireInstructor, async (req, res, next) => {
  try {
    const courseId = String(req.query.courseId ?? "");

    const base = dbClient
      .select(groupSelect)
      .from(groupsTable)
      .leftJoin(
        groupMembersTable,
        eq(groupMembersTable.groupId, groupsTable.id)
      )
      .leftJoin(usersTable, eq(usersTable.id, groupMembersTable.userId));

    const rows = courseId
      ? await base.where(eq(groupsTable.courseId, courseId))
      : await base;

    res.json({ msg: "Fetch groups successfully", data: groupRows(rows) });
  } catch (err) {
    next(err);
  }
});

export default router;