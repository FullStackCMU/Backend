import bcrypt from "bcryptjs";
import { dbClient, dbConn } from "@db/client.js";
import {
  usersTable,
  coursesTable,
  enrollmentsTable,
  groupsTable,
  groupMembersTable,
  roundsTable,
  questionsTable,
  answersTable,
  feedbackSummariesTable,
} from "@db/schema.js";

// ลบตามลำดับ dependency (ลูกก่อนแม่)
async function resetAll() {
  await dbClient.delete(feedbackSummariesTable);
  await dbClient.delete(answersTable);
  await dbClient.delete(questionsTable);
  await dbClient.delete(roundsTable);
  await dbClient.delete(groupMembersTable);
  await dbClient.delete(groupsTable);
  await dbClient.delete(enrollmentsTable);
  await dbClient.delete(usersTable);
  await dbClient.delete(coursesTable);
  console.log("Reset completed");
}

async function seedAll() {
  const hashed = await bcrypt.hash("password123", 10);

  const users = await dbClient
    .insert(usersTable)
    .values([
      { username: "6511500001", name: "สมชาย ใจดี", password: hashed, role: "student" },
      { username: "6511500002", name: "สมหญิง ตั้งใจ", password: hashed, role: "student" },
      { username: "6511500003", name: "อนันต์ พากเพียร", password: hashed, role: "student" },
      { username: "ajarn.nirand", name: "อ.นิรันดร์", password: hashed, role: "instructor" },
    ])
    .returning();

  const students = users.filter((u) => u.role === "student");

  const courses = await dbClient
    .insert(coursesTable)
    .values([
      { courseCode: "261497", name: "Fullstack Development" },
      { courseCode: "261448", name: "Software Engineering" },
    ])
    .returning();

  // ลงทะเบียนนักศึกษาทุกคนในทั้ง 2 วิชา
  await dbClient.insert(enrollmentsTable).values(
    students.flatMap((s) => courses.map((c) => ({ userId: s.id, courseId: c.id })))
  );

  const groups = await dbClient
    .insert(groupsTable)
    .values([
      { name: "FullStackCMU", courseId: courses[0].id, section: "001" },
      { name: "Team Alpha", courseId: courses[1].id, section: "001" },
    ])
    .returning();

  await dbClient.insert(groupMembersTable).values(
    students.flatMap((s) => groups.map((g) => ({ groupId: g.id, userId: s.id })))
  );

  // แบบประเมิน: เปิด 1 ปิด 1 เพื่อทดสอบทั้งสองสถานะ
  const rounds = await dbClient
    .insert(roundsTable)
    .values([
      {
        courseId: courses[0].id,
        name: "ประเมินต้นเทอม",
        description: "สะท้อนการทำงานร่วมกันช่วงเริ่มโปรเจกต์",
        isOpen: false,
      },
      {
        courseId: courses[0].id,
        name: "ประเมินกลางเทอม",
        description: "สะท้อนการทำงานร่วมกันในครึ่งเทอมแรก",
        isOpen: true,
      },
    ])
    .returning();

  await dbClient.insert(questionsTable).values(
    rounds.flatMap((r) => [
      { roundId: r.id, content: "การมีส่วนร่วมในงานกลุ่ม", type: "scale", sortOrder: 1 },
      { roundId: r.id, content: "การสื่อสารกับเพื่อนร่วมทีม", type: "scale", sortOrder: 2 },
      { roundId: r.id, content: "ความรับผิดชอบต่อกำหนดส่งงาน", type: "scale", sortOrder: 3 },
      { roundId: r.id, content: "สิ่งที่ทำได้ดีและอยากให้ทำต่อ", type: "text", sortOrder: 4 },
      { roundId: r.id, content: "สิ่งที่อยากให้ปรับในรอบถัดไป", type: "text", sortOrder: 5 },
    ])
  );

  console.log({
    students: students.map((s) => `${s.username} (${s.id})`),
    courses: courses.map((c) => c.courseCode),
    groups: groups.map((g) => `${g.name} (${g.id})`),
    rounds: rounds.map((r) => `${r.name} · open=${r.isOpen}`),
  });
}

async function main() {
  await resetAll();
  await seedAll();
  dbConn.end();
}

main().catch(async (err) => {
  console.error(err);
  dbConn.end();
  process.exit(1);
});