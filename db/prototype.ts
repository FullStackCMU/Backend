import { dbClient, dbConn } from "@db/client.js";
import {
  usersTable,
  coursesTable,
  enrollmentsTable,
  groupsTable,
  groupMembersTable,
  roundsTable,
  questionsTable,
  submissionsTable,
  ratingsTable,
  flagsTable,
  consentsTable,
} from "@db/schema.js";

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

// ลบตามลำดับ dependency (ลูกก่อนแม่)
async function resetAll() {
  await dbClient.delete(consentsTable);
  await dbClient.delete(flagsTable);
  await dbClient.delete(ratingsTable);
  await dbClient.delete(submissionsTable);
  await dbClient.delete(questionsTable);
  await dbClient.delete(roundsTable);
  await dbClient.delete(groupMembersTable);
  await dbClient.delete(groupsTable);
  await dbClient.delete(enrollmentsTable);
  await dbClient.delete(coursesTable);
  await dbClient.delete(usersTable);
  console.log("Reset completed");
}

async function seedAll() {
  // อาจารย์ = wichai.t, patiphan_leknok = นักศึกษาที่ login ผ่าน CPE mock OAuth ได้จริง
  // ที่เหลือเป็นบัญชีสมมติ (import ไว้ ยังไม่เคย login)
  const [instructor] = await dbClient
    .insert(usersTable)
    .values({
      cmuAccount: "wichai.t@cmu.ac.th",
      firstnameTh: "วิชัย",
      lastnameTh: "ตันติวัฒนกุล",
      firstnameEn: "WICHAI",
      lastnameEn: "TANTIWATTANAKUL",
      accountType: "MISEmpAcc",
    })
    .returning();

  const students = await dbClient
    .insert(usersTable)
    .values([
      { cmuAccount: "somchai_jaidee@cmu.ac.th", studentId: "669999001", firstnameTh: "สมชาย", lastnameTh: "ใจดี", firstnameEn: "SOMCHAI", lastnameEn: "JAIDEE" },
      { cmuAccount: "somying_tangjai@cmu.ac.th", studentId: "669999002", firstnameTh: "สมหญิง", lastnameTh: "ตั้งใจ", firstnameEn: "SOMYING", lastnameEn: "TANGJAI" },
      { cmuAccount: "patiphan_leknok@cmu.ac.th", studentId: "660610771", firstnameTh: "ปฏิพันธ์", lastnameTh: "เลขนอก", firstnameEn: "PATIPHAN", lastnameEn: "LEKNOK" },
      { cmuAccount: "malee_srisuk@cmu.ac.th", studentId: "669999004", firstnameTh: "มาลี", lastnameTh: "ศรีสุข", firstnameEn: "MALEE", lastnameEn: "SRISUK" },
      { cmuAccount: "kittipong_wongdee@cmu.ac.th", studentId: "669999005", firstnameTh: "กิตติพงษ์", lastnameTh: "วงศ์ดี", firstnameEn: "KITTIPONG", lastnameEn: "WONGDEE" },
    ].map((s) => ({ ...s, accountType: "StdAcc" as const })))
    .returning();

  const [course] = await dbClient
    .insert(coursesTable)
    .values({
      courseCode: "261497",
      title: "Fullstack Development",
      section: "001",
      semester: 1,
      academicYear: 2569,
      createdBy: instructor.id,
    })
    .returning();

  await dbClient.insert(enrollmentsTable).values([
    { courseId: course.id, userId: instructor.id, role: "instructor" },
    ...students.map((s) => ({
      courseId: course.id,
      userId: s.id,
      role: "student" as const,
    })),
  ]);

  const contractText =
    "1. เข้าประชุมทีมทุกสัปดาห์\n2. แจ้งล่วงหน้าหากส่งงานไม่ทัน\n3. รับฟังความเห็นของทุกคน";

  const groups = await dbClient
    .insert(groupsTable)
    .values([
      { courseId: course.id, name: "Team Alpha", maxMembers: 3, contractText },
      { courseId: course.id, name: "Team Beta", maxMembers: 3, contractText },
    ])
    .returning();

  // Alpha 3 คน รวม patiphan (ยอมรับ contract แล้ว), Beta 2 คน (ยังไม่ยอมรับ)
  await dbClient.insert(groupMembersTable).values([
    ...students.slice(0, 3).map((s) => ({
      groupId: groups[0].id,
      courseId: course.id,
      userId: s.id,
      contractAcceptedAt: daysFromNow(-20),
    })),
    ...students.slice(3).map((s) => ({
      groupId: groups[1].id,
      courseId: course.id,
      userId: s.id,
    })),
  ]);

  // รอบ 1 ปิดแล้ว + ปล่อยคะแนนแล้ว, รอบ 2 เปิดอยู่ตอนนี้
  const rounds = await dbClient
    .insert(roundsTable)
    .values([
      {
        courseId: course.id,
        sequenceNo: 1,
        opensAt: daysFromNow(-21),
        closesAt: daysFromNow(-14),
        scoresReleasedAt: daysFromNow(-10),
      },
      {
        courseId: course.id,
        sequenceNo: 2,
        opensAt: daysFromNow(-1),
        closesAt: daysFromNow(6),
      },
    ])
    .returning();

  // ชุดคำถามมาตรฐาน (ใช้ร่วมกันทุกรอบ)
  const questions = await dbClient
    .insert(questionsTable)
    .values([
      { orderNo: 1, type: "rating", prompt: "การมีส่วนร่วมในงานกลุ่ม" },
      { orderNo: 2, type: "rating", prompt: "การสื่อสารกับเพื่อนร่วมทีม" },
      { orderNo: 3, type: "rating", prompt: "ความรับผิดชอบต่อกำหนดส่งงาน" },
      { orderNo: 4, type: "text", prompt: "สิ่งที่ทำได้ดีและอยากให้ทำต่อ" },
      { orderNo: 5, type: "text", prompt: "สิ่งที่อยากให้ปรับในรอบถัดไป" },
    ])
    .returning();

  console.log({
    instructor: `${instructor.cmuAccount} (${instructor.id})`,
    students: students.map((s) => `${s.cmuAccount} ${s.studentId} (${s.id})`),
    course: `${course.courseCode} sec ${course.section} ${course.semester}/${course.academicYear} (${course.id})`,
    groups: groups.map((g) => `${g.name} (${g.id})`),
    rounds: rounds.map(
      (r) => `#${r.sequenceNo} ${r.opensAt.toISOString()} → ${r.closesAt.toISOString()}`
    ),
    questions: questions.length,
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
