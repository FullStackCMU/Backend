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

// ต้องตรงกับ Backend/src/config.ts (CONSENT_POLICY_VERSION)
const CONSENT_POLICY_VERSION = "2026-09-v1";

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

type Scores = [number, number, number]; // คำถามข้อ 1–3 (rating)
type Comments = [string, string]; // คำถามข้อ 4–5 (text)

/**
 * คำตอบรอบ 1 — evaluator → evaluatee → [คะแนน 3 ข้อ, ความเห็น 2 ข้อ]
 * ออกแบบให้มีทั้งคนที่ให้คะแนนตัวเองสูงกว่าเพื่อนให้ (กิตติพงษ์) และต่ำกว่า (สมหญิง)
 * และความเห็นมีทั้งชม ติ และกลางๆ
 */
const ROUND1: Record<string, Record<string, [Scores, Comments]>> = {
  somchai: {
    somchai: [[4, 4, 5], [
      "ทำส่วน backend เสร็จตามกำหนด และช่วยตั้งค่าโปรเจกต์ให้ทุกคนเริ่มงานได้เร็ว",
      "ควรเขียนเอกสารอธิบายโค้ดให้เพื่อนอ่านต่อได้ง่ายกว่านี้",
    ]],
    somying: [[4, 2, 4], [
      "ออกแบบหน้าจอได้สวยและคิดถึงคนใช้งานจริง",
      "บางครั้งตอบแชตกลุ่มช้า งานที่ต้องรอกันเลยสะดุด อยากให้อัปเดตความคืบหน้าบ่อยขึ้นหน่อย",
    ]],
    thanapon: [[2, 3, 2], [
      "เสนอไอเดียตอนประชุมครั้งแรกได้ดี",
      "ช่วงหลังแทบไม่ได้เข้าประชุม และงานที่รับไปยังไม่เสร็จ ถ้าติดปัญหาบอกทีมได้เลย จะได้ช่วยกัน",
    ]],
  },
  somying: {
    somying: [[3, 3, 3], [
      "รับผิดชอบงาน UI ครบทุกหน้าที่ได้รับมอบหมาย",
      "ต้องแบ่งเวลาให้ดีกว่านี้ ช่วงสอบกลางภาคส่งงานช้าไปหน่อย",
    ]],
    somchai: [[5, 4, 5], [
      "อธิบายโค้ดใจเย็นมาก และช่วยแก้บั๊กให้คนอื่นเสมอ",
      "ไม่มีอะไรต้องปรับมาก อาจลองให้คนอื่นได้ทำส่วนที่ยากบ้าง",
    ]],
    thanapon: [[2, 2, 3], [
      "เวลาเข้าประชุมก็ตั้งใจฟังและช่วยจดบันทึก",
      "ยังไม่ค่อยเห็นผลงานในรอบนี้ อยากให้เลือกรับงานที่ทำได้จริงแล้วทำให้เสร็จ",
    ]],
  },
  malee: {
    malee: [[4, 4, 4], [
      "จัดตารางงานและติดตามความคืบหน้าของทีมได้สม่ำเสมอ",
      "ควรลงมือเขียนโค้ดเองมากขึ้น ไม่ใช่แค่ประสานงาน",
    ]],
    kittipong: [[3, 3, 2], [
      "เขียนโค้ดเร็วและแก้ปัญหาเฉพาะหน้าเก่ง",
      "ส่งงานเลยกำหนดสองครั้งโดยไม่แจ้งก่อน ถ้าจะช้าอยากให้บอกทีมล่วงหน้า",
    ]],
  },
  kittipong: {
    kittipong: [[5, 4, 4], [
      "ทำส่วนเชื่อมต่อฐานข้อมูลได้ครบตามที่ตกลง",
      "จะพยายามส่งงานให้ตรงเวลามากขึ้น",
    ]],
    malee: [[5, 5, 4], [
      "คอยดูภาพรวมให้ทีม ทุกคนรู้ว่าต้องทำอะไรต่อ",
      "โดยรวมโอเค อาจลดจำนวนประชุมลงหน่อยถ้าไม่มีเรื่องด่วน",
    ]],
  },
};

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

  const studentRows = [
    { key: "somchai", cmuAccount: "somchai_jaidee@cmu.ac.th", studentId: "669999001", firstnameTh: "สมชาย", lastnameTh: "ใจดี", firstnameEn: "SOMCHAI", lastnameEn: "JAIDEE" },
    { key: "somying", cmuAccount: "somying_tangjai@cmu.ac.th", studentId: "669999002", firstnameTh: "สมหญิง", lastnameTh: "ตั้งใจ", firstnameEn: "SOMYING", lastnameEn: "TANGJAI" },
    { key: "patiphan", cmuAccount: "patiphan_leknok@cmu.ac.th", studentId: "660610771", firstnameTh: "ปฏิพันธ์", lastnameTh: "เลขนอก", firstnameEn: "PATIPHAN", lastnameEn: "LEKNOK" },
    { key: "malee", cmuAccount: "malee_srisuk@cmu.ac.th", studentId: "669999004", firstnameTh: "มาลี", lastnameTh: "ศรีสุข", firstnameEn: "MALEE", lastnameEn: "SRISUK" },
    { key: "kittipong", cmuAccount: "kittipong_wongdee@cmu.ac.th", studentId: "669999005", firstnameTh: "กิตติพงษ์", lastnameTh: "วงศ์ดี", firstnameEn: "KITTIPONG", lastnameEn: "WONGDEE" },
    { key: "thanapon", cmuAccount: "thanapon_meesuk@cmu.ac.th", studentId: "669999006", firstnameTh: "ธนพล", lastnameTh: "มีสุข", firstnameEn: "THANAPON", lastnameEn: "MEESUK" },
  ];
  const inserted = await dbClient
    .insert(usersTable)
    .values(studentRows.map(({ key: _, ...s }) => ({ ...s, accountType: "StdAcc" as const })))
    .returning();
  const students = inserted;
  const byKey = Object.fromEntries(studentRows.map((s, i) => [s.key, inserted[i]]));

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

  // Alpha รับได้ 4 คน (มี 3) และ Beta 3 คน (มี 2) → patiphan เลือกเข้าได้ทั้งสองกลุ่ม
  const [alpha, beta] = await dbClient
    .insert(groupsTable)
    .values([
      { courseId: course.id, name: "Team Alpha", maxMembers: 4, contractText },
      { courseId: course.id, name: "Team Beta", maxMembers: 3, contractText },
    ])
    .returning();

  // patiphan ยังไม่มีกลุ่ม (ทดสอบ flow เข้ากลุ่ม)
  // Alpha: สมชาย สมหญิง ธนพล (ยอมรับข้อตกลงแล้ว) — ธนพลไม่ได้ส่งรอบ 1
  // Beta: มาลี กิตติพงษ์ (ยังไม่ยอมรับข้อตกลง — สมมติว่าอาจารย์แก้ข้อตกลงหลังรอบ 1)
  const members: [string, typeof alpha][] = [
    ["somchai", alpha],
    ["somying", alpha],
    ["thanapon", alpha],
    ["malee", beta],
    ["kittipong", beta],
  ];
  await dbClient.insert(groupMembersTable).values(
    members.map(([key, group]) => ({
      groupId: group.id,
      courseId: course.id,
      userId: byKey[key].id,
      joinedAt: daysFromNow(-25),
      contractAcceptedAt: group === alpha ? daysFromNow(-24) : null,
    }))
  );

  // รอบ 1 ปิดแล้ว + เผยแพร่ทั้งคะแนนและฟีดแบ็ก, รอบ 2 เปิดอยู่ตอนนี้
  const [round1, round2] = await dbClient
    .insert(roundsTable)
    .values([
      {
        courseId: course.id,
        sequenceNo: 1,
        opensAt: daysFromNow(-21),
        closesAt: daysFromNow(-14),
        scoresReleasedAt: daysFromNow(-10),
        feedbackReleasedAt: daysFromNow(-10),
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
  const ratingQuestions = questions.filter((q) => q.type === "rating");
  const textQuestions = questions.filter((q) => q.type === "text");

  // คนที่ส่งรอบ 1 ต้องให้ consent แล้ว (backend บังคับตอนส่งจริง)
  await dbClient.insert(consentsTable).values(
    Object.keys(ROUND1).map((key) => ({
      userId: byKey[key].id,
      policyVersion: CONSENT_POLICY_VERSION,
      acceptedAt: daysFromNow(-24),
    }))
  );

  // submissions + ratings ของรอบ 1
  for (const [evaluatorKey, targets] of Object.entries(ROUND1)) {
    const group = members.find(([k]) => k === evaluatorKey)![1];
    const [submission] = await dbClient
      .insert(submissionsTable)
      .values({
        roundId: round1.id,
        groupId: group.id,
        evaluatorId: byKey[evaluatorKey].id,
        status: "submitted",
        submittedAt: daysFromNow(-16),
        createdAt: daysFromNow(-19),
      })
      .returning();

    await dbClient.insert(ratingsTable).values(
      Object.entries(targets).flatMap(([targetKey, [scores, comments]]) => [
        ...ratingQuestions.map((q, i) => ({
          submissionId: submission.id,
          questionId: q.id,
          evaluateeId: byKey[targetKey].id,
          score: scores[i],
        })),
        ...textQuestions.map((q, i) => ({
          submissionId: submission.id,
          questionId: q.id,
          evaluateeId: byKey[targetKey].id,
          comment: comments[i],
        })),
      ])
    );
  }

  console.log({
    instructor: `${instructor.cmuAccount} (${instructor.id})`,
    students: students.map((s) => `${s.cmuAccount} ${s.studentId} (${s.id})`),
    course: `${course.courseCode} sec ${course.section} ${course.semester}/${course.academicYear} (${course.id})`,
    groups: [alpha, beta].map((g) => `${g.name} (${g.id})`),
    rounds: [round1, round2].map(
      (r) => `#${r.sequenceNo} ${r.opensAt.toISOString()} → ${r.closesAt.toISOString()}`
    ),
    questions: questions.length,
    round1Submissions: Object.keys(ROUND1).length,
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
