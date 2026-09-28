import { dbClient } from "@db/client.js";
import {
  enrollmentsTable,
  groupMembersTable,
  groupsTable,
  usersTable,
} from "@db/schema.js";
import { and, asc, eq, isNull } from "drizzle-orm";

type NameFields = Pick<
  typeof usersTable.$inferSelect,
  "firstnameTh" | "lastnameTh" | "firstnameEn" | "lastnameEn" | "cmuAccount"
>;

/** ชื่อที่แสดง — ไทยก่อน แล้วอังกฤษ แล้ว CMU account (ตรงกับ displayName ฝั่ง Frontend) */
export function displayName(u: NameFields) {
  const th = [u.firstnameTh, u.lastnameTh].filter(Boolean).join(" ");
  if (th) return th;
  const en = [u.firstnameEn, u.lastnameEn].filter(Boolean).join(" ");
  return en || u.cmuAccount;
}

export const personColumns = {
  id: usersTable.id,
  studentId: usersTable.studentId,
  cmuAccount: usersTable.cmuAccount,
  firstnameTh: usersTable.firstnameTh,
  lastnameTh: usersTable.lastnameTh,
  firstnameEn: usersTable.firstnameEn,
  lastnameEn: usersTable.lastnameEn,
  firstLoginAt: usersTable.firstLoginAt,
};

type PersonRow = { [K in keyof typeof personColumns]: (typeof usersTable.$inferSelect)[K] };

export function toPerson(row: PersonRow) {
  return {
    id: row.id,
    studentId: row.studentId,
    cmuAccount: row.cmuAccount,
    name: displayName(row),
    firstLoginAt: row.firstLoginAt,
  };
}

export async function listCourseStudents(courseId: string) {
  const students = await dbClient
    .select(personColumns)
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .where(
      and(
        eq(enrollmentsTable.courseId, courseId),
        eq(enrollmentsTable.role, "student")
      )
    )
    .orderBy(asc(usersTable.studentId), asc(usersTable.cmuAccount));

  const memberships = await dbClient
    .select({
      userId: groupMembersTable.userId,
      groupId: groupsTable.id,
      groupName: groupsTable.name,
    })
    .from(groupMembersTable)
    .innerJoin(groupsTable, eq(groupsTable.id, groupMembersTable.groupId))
    .where(
      and(
        eq(groupMembersTable.courseId, courseId),
        isNull(groupMembersTable.leftAt)
      )
    );

  return students.map((s) => {
    const m = memberships.find((x) => x.userId === s.id);
    return {
      ...toPerson(s),
      group: m ? { id: m.groupId, name: m.groupName } : null,
    };
  });
}
