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

// ต้องตรงกับ CONSENT_POLICY_VERSION ใน Backend/src/config.ts
const CONSENT_POLICY_VERSION = "2026-09-v4";

// ลบลูกก่อนแม่ ไม่งั้นติด foreign key
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

type Scores = [number, number, number, number, number]; // 5 มิติตามลำดับใน RUBRIC
type Comments = [string, string]; // จุดแข็ง, สิ่งที่อยากให้ปรับ

// ตั้งใจให้กิตติพงษ์ให้ตัวเองสูงกว่าเพื่อน และสมหญิงต่ำกว่า (ใช้ทดสอบไฮไลต์ในแดชบอร์ด)
const ROUND1: Record<string, Record<string, [Scores, Comments]>> = {
  somchai: {
    somchai: [[4, 4, 5, 4, 5], [
      "ทำส่วน backend เสร็จตามกำหนด และช่วยตั้งค่าโปรเจกต์ให้ทุกคนเริ่มงานได้เร็ว",
      "ควรเขียนเอกสารอธิบายโค้ดให้เพื่อนอ่านต่อได้ง่ายกว่านี้",
    ]],
    somying: [[4, 2, 4, 4, 5], [
      "ออกแบบหน้าจอได้สวยและคิดถึงคนใช้งานจริง",
      "บางครั้งตอบแชตกลุ่มช้า งานที่ต้องรอกันเลยสะดุด อยากให้อัปเดตความคืบหน้าบ่อยขึ้นหน่อย",
    ]],
    thanapon: [[2, 3, 2, 2, 3], [
      "เสนอไอเดียตอนประชุมครั้งแรกได้ดี",
      "ช่วงหลังแทบไม่ได้เข้าประชุม และงานที่รับไปยังไม่เสร็จ ถ้าติดปัญหาบอกทีมได้เลย จะได้ช่วยกัน",
    ]],
  },
  somying: {
    somying: [[3, 3, 3, 3, 3], [
      "รับผิดชอบงาน UI ครบทุกหน้าที่ได้รับมอบหมาย",
      "ต้องแบ่งเวลาให้ดีกว่านี้ ช่วงสอบกลางภาคส่งงานช้าไปหน่อย",
    ]],
    somchai: [[5, 4, 5, 5, 5], [
      "อธิบายโค้ดใจเย็นมาก และช่วยแก้บั๊กให้คนอื่นเสมอ",
      "ไม่มีอะไรต้องปรับมาก อาจลองให้คนอื่นได้ทำส่วนที่ยากบ้าง",
    ]],
    thanapon: [[2, 2, 2, 3, 3], [
      "เวลาเข้าประชุมก็ตั้งใจฟังและช่วยจดบันทึก",
      "ยังไม่ค่อยเห็นผลงานในรอบนี้ อยากให้เลือกรับงานที่ทำได้จริงแล้วทำให้เสร็จ",
    ]],
  },
  malee: {
    malee: [[4, 4, 5, 4, 3], [
      "จัดตารางงานและติดตามความคืบหน้าของทีมได้สม่ำเสมอ",
      "ควรลงมือเขียนโค้ดเองมากขึ้น ไม่ใช่แค่ประสานงาน",
    ]],
    kittipong: [[3, 3, 2, 3, 4], [
      "เขียนโค้ดเร็วและแก้ปัญหาเฉพาะหน้าเก่ง",
      "ส่งงานเลยกำหนดสองครั้งโดยไม่แจ้งก่อน ถ้าจะช้าอยากให้บอกทีมล่วงหน้า",
    ]],
  },
  kittipong: {
    kittipong: [[5, 4, 4, 5, 5], [
      "ทำส่วนเชื่อมต่อฐานข้อมูลได้ครบตามที่ตกลง",
      "จะพยายามส่งงานให้ตรงเวลามากขึ้น",
    ]],
    malee: [[5, 5, 5, 4, 3], [
      "คอยดูภาพรวมให้ทีม ทุกคนรู้ว่าต้องทำอะไรต่อ",
      "โดยรวมโอเค อาจลดจำนวนประชุมลงหน่อยถ้าไม่มีเรื่องด่วน",
    ]],
  },
};

// patiphan ต้องมีผู้ประเมิน ≥ MIN_PEERS_FOR_ANONYMITY คน ไม่งั้นผลถูกซ่อน
const COURSE2_ROUND1: Record<string, Record<string, [Scores, Comments]>> = {
  patiphan: {
    patiphan: [[4, 3, 4, 4, 4], [
      "ดูแลการ deploy และแก้ปัญหา CI ให้ทีมได้ทันเวลา",
      "ควรแบ่งงานให้คนอื่นมากขึ้น ไม่รับไว้ทำคนเดียวทั้งหมด",
    ]],
    somying: [[4, 4, 5, 5, 4], [
      "เขียน test ละเอียดมาก ช่วยจับบั๊กได้หลายจุดก่อนส่งงาน",
      "อยากให้ถามในกลุ่มเร็วขึ้นเวลาติดปัญหา ไม่ต้องเกรงใจ",
    ]],
    kittipong: [[3, 3, 2, 3, 4], [
      "ช่วยออกแบบฐานข้อมูลได้ดี คิดเผื่อกรณีพิเศษไว้ครบ",
      "ส่งงานช้ากว่าที่ตกลงไว้ ทำให้คนอื่นต้องรอ",
    ]],
  },
  somying: {
    somying: [[4, 4, 4, 4, 4], [
      "เขียน test ครอบคลุมเกือบทุก endpoint",
      "ต้องกล้าเสนอความเห็นในที่ประชุมมากขึ้น",
    ]],
    patiphan: [[5, 4, 4, 5, 5], [
      "เป็นคนจุดประกายให้ทีมเริ่มงานเร็ว และตอบคำถามเพื่อนเสมอ",
      "บางครั้งแก้โค้ดของคนอื่นโดยไม่บอกก่อน อยากให้เปิด PR ให้ทุกคนดูก่อน",
    ]],
    kittipong: [[3, 2, 3, 3, 4], [
      "เข้าประชุมตรงเวลาทุกครั้ง",
      "งานที่รับไปมักเสร็จไม่ครบ อยากให้ประเมินเวลาให้สมจริงขึ้น",
    ]],
  },
  kittipong: {
    kittipong: [[4, 4, 3, 4, 5], [
      "ทำ schema ฐานข้อมูลเสร็จตามที่ตกลง",
      "ต้องจัดเวลาให้ดีกว่านี้",
    ]],
    patiphan: [[5, 5, 4, 4, 5], [
      "ช่วยรีวิวโค้ดละเอียดและอธิบายเข้าใจง่าย",
      "โดยรวมดีแล้ว อาจลดการประชุมที่ยาวเกินไปลงหน่อย",
    ]],
    somying: [[4, 5, 4, 5, 4], [
      "ละเอียดรอบคอบ งานที่ส่งมีคุณภาพ",
      "ไม่มีอะไรต้องปรับ ทำแบบนี้ต่อไป",
    ]],
  },
};

// กลุ่มตัวอย่างสำหรับแดชบอร์ด (ใส่แค่คะแนน ความเห็นหยิบจาก STRENGTHS / IMPROVEMENTS)
// Gamma: ทีมปกติ ไม่มีสัญญาณ
// Delta: อนันต์ให้เพื่อน 5 ทุกข้อ, สุดากดคะแนนเพื่อนแต่ให้ตัวเองสูง, ปรีชาได้คะแนนต่ำ, นงนุชส่งข้อความที่ AI เตือน
// Epsilon: ชัยวัฒน์ให้ตัวเองต่ำกว่าที่เพื่อนให้
const DEMO_ROUND1: Record<string, Record<string, Scores>> = {
  napat: { napat: [4, 4, 5, 4, 4], pimchanok: [5, 4, 4, 5, 4], wirat: [4, 4, 4, 4, 5], kanya: [4, 5, 4, 4, 4] },
  pimchanok: { pimchanok: [4, 5, 4, 4, 4], napat: [4, 4, 5, 4, 5], wirat: [4, 4, 4, 5, 4], kanya: [5, 5, 4, 4, 4] },
  wirat: { wirat: [4, 4, 4, 4, 5], napat: [5, 4, 4, 4, 4], pimchanok: [4, 5, 4, 4, 4], kanya: [4, 4, 5, 4, 4] },
  kanya: { kanya: [4, 4, 4, 5, 4], napat: [4, 5, 5, 4, 4], pimchanok: [5, 4, 4, 4, 5], wirat: [4, 4, 5, 4, 4] },

  anan: { anan: [5, 5, 5, 5, 5], suda: [5, 5, 5, 5, 5], preecha: [5, 5, 5, 5, 5], nongnuch: [5, 5, 5, 5, 5] },
  suda: { suda: [4, 4, 4, 4, 4], anan: [3, 2, 3, 2, 3], preecha: [1, 2, 2, 1, 2], nongnuch: [3, 2, 2, 3, 3] },
  preecha: { preecha: [4, 4, 4, 4, 4], anan: [4, 4, 3, 4, 4], suda: [4, 3, 4, 4, 4], nongnuch: [4, 4, 4, 3, 4] },
  nongnuch: { nongnuch: [4, 4, 4, 4, 4], anan: [4, 5, 4, 4, 4], suda: [4, 3, 4, 4, 4], preecha: [2, 2, 3, 2, 3] },

  chaiwat: { chaiwat: [3, 3, 3, 3, 3], ploy: [5, 4, 5, 4, 5], tawan: [4, 4, 4, 5, 4] },
  ploy: { ploy: [4, 5, 4, 4, 5], chaiwat: [5, 5, 4, 5, 5], tawan: [4, 4, 4, 4, 4] },
  tawan: { tawan: [4, 4, 4, 4, 4], chaiwat: [5, 4, 5, 5, 4], ploy: [4, 5, 4, 5, 4] },
};

// รอบที่เปิดอยู่ — Gamma ส่งแล้ว 2 จาก 4 คน
const DEMO_OPEN_ROUND: Record<string, Record<string, Scores>> = {
  napat: { napat: [4, 5, 5, 4, 4], pimchanok: [5, 5, 4, 5, 4], wirat: [4, 4, 5, 4, 5], kanya: [4, 5, 4, 4, 5] },
  pimchanok: { pimchanok: [5, 5, 4, 4, 4], napat: [5, 4, 5, 4, 5], wirat: [4, 4, 4, 5, 4], kanya: [5, 5, 4, 5, 4] },
};

const STRENGTHS = [
  "รับผิดชอบงานส่วนของตัวเองได้ดีและส่งตรงเวลา",
  "อธิบายงานให้เพื่อนเข้าใจง่าย ถามอะไรก็ช่วยตอบ",
  "เสนอไอเดียใหม่ในที่ประชุมเสมอ",
  "ตรวจงานละเอียด ช่วยจับข้อผิดพลาดก่อนส่ง",
  "ใจเย็นเวลาทีมมีปัญหาและช่วยหาทางออก",
];
const IMPROVEMENTS = [
  "อยากให้อัปเดตความคืบหน้าในกลุ่มบ่อยขึ้น",
  "ควรแบ่งเวลาให้งานกลุ่มมากขึ้นในช่วงใกล้ส่ง",
  "อยากให้กล้าแสดงความเห็นในที่ประชุมมากกว่านี้",
  "บางครั้งรับงานไว้มากเกินไป ลองขอให้เพื่อนช่วยบ้าง",
  "ควรเขียนสรุปงานที่ทำไว้ให้เพื่อนอ่านต่อได้",
];

// คะแนนรอบถัดไปของกลุ่มเดิม: บวก/ลบจากรอบก่อนตามคนที่ถูกประเมิน (peer = ที่เพื่อนให้, self = ที่ให้ตัวเอง)
function nextRound(
  prev: Record<string, Record<string, Scores>>,
  change: { peer: Record<string, number>; self: Record<string, number> }
) {
  const out: Record<string, Record<string, Scores>> = {};
  for (const [evaluator, targets] of Object.entries(prev)) {
    out[evaluator] = {};
    for (const [target, scores] of Object.entries(targets)) {
      const delta = (evaluator === target ? change.self[target] : change.peer[target]) ?? 0;
      out[evaluator][target] = scores.map((s) => Math.min(5, Math.max(1, s + delta))) as Scores;
    }
  }
  return out;
}

function withComments(scores: Record<string, Record<string, Scores>>) {
  let n = 0;
  const out: Record<string, Record<string, [Scores, Comments]>> = {};
  for (const [evaluator, targets] of Object.entries(scores)) {
    out[evaluator] = {};
    for (const [target, s] of Object.entries(targets)) {
      out[evaluator][target] = [s, [STRENGTHS[n % STRENGTHS.length], IMPROVEMENTS[n % IMPROVEMENTS.length]]];
      n++;
    }
  }
  return out;
}

// รูบริกมาตรฐาน Phase 1 — 5 มิติของ CATME (Ohland et al., 2012) มีคำอธิบายพฤติกรรมที่ระดับ 1, 3, 5
// focus (ด้านงาน/ด้านทีม) เป็นการจัดกลุ่มของระบบนี้เอง ไม่ได้มาจาก CATME
const RUBRIC: (typeof questionsTable.$inferInsert)[] = [
  {
    orderNo: 1,
    type: "rating",
    prompt: "การมีส่วนร่วมในงาน",
    focus: "task",
    description: "ทำงานส่วนของตัวเองครบ ตรงเวลา มีคุณภาพ และช่วยเพื่อน",
    anchors: [
      { score: 1, text: "ทำงานไม่ครบส่วนของตัวเอง งานหยาบหรือไม่เสร็จ ไม่ทันกำหนด มาสาย ไม่เตรียมตัว หรือขาดประชุมทีม ไม่ช่วยเพื่อน และเลิกทำเมื่องานยาก" },
      { score: 3, text: "ทำงานส่วนของตัวเองครบด้วยคุณภาพที่ยอมรับได้ รักษาคำมั่นและส่งงานตรงเวลา ช่วยเพื่อนที่มีปัญหาเมื่อทำได้ง่ายหรือจำเป็น" },
      { score: 5, text: "ทำงานได้มากหรือมีคุณภาพสูงกว่าที่คาดไว้ มีส่วนสำคัญที่ทำให้งานของทีมดีขึ้น และช่วยเพื่อนที่ทำงานไม่ทัน" },
    ],
  },
  {
    orderNo: 2,
    type: "rating",
    prompt: "การปฏิสัมพันธ์กับเพื่อน",
    focus: "team",
    description: "รับฟังเพื่อน สื่อสารชัดเจน แบ่งปันข้อมูล รับ feedback",
    anchors: [
      { score: 1, text: "ขัดจังหวะ เมินเฉย สั่งการ หรือล้อเลียนเพื่อน ตัดสินใจเรื่องที่กระทบเพื่อนโดยไม่ถาม ไม่แบ่งปันข้อมูล บ่น แก้ตัว หรือไม่ปฏิสัมพันธ์กับทีม ปกป้องตัวเองและไม่รับคำแนะนำ" },
      { score: 3, text: "รับฟังและให้เกียรติเพื่อน สื่อสารชัดเจนและแบ่งปันข้อมูล มีส่วนร่วมในกิจกรรมทีมเต็มที่ รับฟังและตอบสนองต่อ feedback จากเพื่อน" },
      { score: 5, text: "ถามและสนใจความคิดเห็นของเพื่อน ดูแลให้ทุกคนรับรู้และเข้าใจกัน ให้กำลังใจทีม ขอ feedback แล้วนำไปปรับปรุงตัวเอง" },
    ],
  },
  {
    orderNo: 3,
    type: "rating",
    prompt: "การดูแลให้ทีมเดินตามแผน",
    focus: "team",
    description: "ติดตามความคืบหน้า สังเกตปัญหา และให้ feedback",
    anchors: [
      { score: 1, text: "ไม่รู้ว่าทีมบรรลุเป้าหมายหรือไม่ ไม่สนใจความคืบหน้าของเพื่อน เลี่ยงไม่คุยเรื่องปัญหาของทีมแม้จะเห็นชัด" },
      { score: 3, text: "สังเกตการเปลี่ยนแปลงที่กระทบความสำเร็จของทีม รู้ว่าแต่ละคนควรทำอะไรและสังเกตเห็นปัญหา เตือนหรือเสนอทางแก้เมื่อทีมเสี่ยงล้มเหลว" },
      { score: 5, text: "เฝ้าดูสถานการณ์ที่กระทบทีมและติดตามความคืบหน้า ดูแลให้เพื่อนทำงานคืบหน้าตามที่ควร ให้ feedback ที่เจาะจง ทันเวลา และสร้างสรรค์" },
    ],
  },
  {
    orderNo: 4,
    type: "rating",
    prompt: "การคาดหวังคุณภาพ",
    focus: "task",
    description: "ผลักดันให้ทีมทำงานให้ดี เชื่อว่าทีมทำได้",
    anchors: [
      { score: 1, text: "พอใจแม้ทีมทำไม่ถึงมาตรฐาน อยากให้ทีมเลี่ยงงานแม้จะส่งผลเสีย ไม่เชื่อว่าทีมทำได้ตามข้อกำหนด" },
      { score: 3, text: "สนับสนุนให้ทีมทำงานดีครบตามข้อกำหนด อยากให้ทีมทำได้ดีพอจะได้คะแนนเต็ม เชื่อว่าทีมทำได้ครบตามหน้าที่" },
      { score: 5, text: "กระตุ้นให้ทีมทำงานให้ดีเยี่ยม ใส่ใจให้ทีมทำงานโดดเด่นแม้ไม่มีรางวัลเพิ่ม เชื่อว่าทีมทำงานได้ดีเยี่ยม" },
    ],
  },
  {
    orderNo: 5,
    type: "rating",
    prompt: "ความรู้และทักษะที่เกี่ยวข้อง",
    focus: "task",
    description: "มีความรู้/ทักษะที่งานต้องใช้ และพัฒนาเพิ่มเมื่อจำเป็น",
    anchors: [
      { score: 1, text: "ขาดคุณสมบัติพื้นฐานที่ต้องใช้ในทีม ไม่สามารถหรือไม่ยอมพัฒนาความรู้และทักษะ ทำหน้าที่ใดของเพื่อนแทนไม่ได้เลย" },
      { score: 3, text: "มีความรู้และทักษะเพียงพอที่จะช่วยงานทีม หาความรู้เพิ่มเมื่อจำเป็นต่อการทำงานให้ครบ ทำงานบางส่วนของเพื่อนแทนได้" },
      { score: 5, text: "มีความรู้ ทักษะ และความสามารถที่ทำงานได้ดีเยี่ยม หาความรู้ใหม่เพื่อยกระดับงานทีม ทำหน้าที่แทนสมาชิกคนใดก็ได้เมื่อจำเป็น" },
    ],
  },
  { orderNo: 6, type: "text", prompt: "จุดแข็ง" },
  { orderNo: 7, type: "text", prompt: "สิ่งที่อยากให้ปรับ" },
];

type Question = typeof questionsTable.$inferSelect;
type User = typeof usersTable.$inferSelect;

async function insertRoundAnswers(opts: {
  roundId: string;
  answers: Record<string, Record<string, [Scores, Comments]>>;
  groupIdOf: (key: string) => string;
  byKey: Record<string, User>;
  questions: Question[];
  submittedAt: Date;
}) {
  const ratingQuestions = opts.questions.filter((q) => q.type === "rating");
  const textQuestions = opts.questions.filter((q) => q.type === "text");
  const submissionIds: Record<string, string> = {};
  for (const [evaluatorKey, targets] of Object.entries(opts.answers)) {
    const [submission] = await dbClient
      .insert(submissionsTable)
      .values({
        roundId: opts.roundId,
        groupId: opts.groupIdOf(evaluatorKey),
        evaluatorId: opts.byKey[evaluatorKey].id,
        status: "submitted",
        submittedAt: opts.submittedAt,
        createdAt: new Date(opts.submittedAt.getTime() - 3 * DAY),
      })
      .returning();
    submissionIds[evaluatorKey] = submission.id;

    await dbClient.insert(ratingsTable).values(
      Object.entries(targets).flatMap(([targetKey, [scores, comments]]) => [
        ...ratingQuestions.map((q, i) => ({
          submissionId: submission.id,
          questionId: q.id,
          evaluateeId: opts.byKey[targetKey].id,
          score: scores[i],
        })),
        ...textQuestions.map((q, i) => ({
          submissionId: submission.id,
          questionId: q.id,
          evaluateeId: opts.byKey[targetKey].id,
          comment: comments[i],
        })),
      ])
    );
  }
  return submissionIds;
}

async function seedAll() {
  // wichai.t และ patiphan_leknok login ผ่าน mock OAuth ได้จริง ที่เหลือเป็นบัญชีสมมติ
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
    { key: "napat", cmuAccount: "napat_saengthong@cmu.ac.th", studentId: "669999007", firstnameTh: "ณภัทร", lastnameTh: "แสงทอง", firstnameEn: "NAPAT", lastnameEn: "SAENGTHONG" },
    { key: "pimchanok", cmuAccount: "pimchanok_jaingam@cmu.ac.th", studentId: "669999008", firstnameTh: "พิมพ์ชนก", lastnameTh: "ใจงาม", firstnameEn: "PIMCHANOK", lastnameEn: "JAINGAM" },
    { key: "wirat", cmuAccount: "wirat_kongman@cmu.ac.th", studentId: "669999009", firstnameTh: "วิรัช", lastnameTh: "คงมั่น", firstnameEn: "WIRAT", lastnameEn: "KONGMAN" },
    { key: "kanya", cmuAccount: "kanya_sriwong@cmu.ac.th", studentId: "669999010", firstnameTh: "กัญญา", lastnameTh: "ศรีวงศ์", firstnameEn: "KANYA", lastnameEn: "SRIWONG" },
    { key: "anan", cmuAccount: "anan_thongdee@cmu.ac.th", studentId: "669999011", firstnameTh: "อนันต์", lastnameTh: "ทองดี", firstnameEn: "ANAN", lastnameEn: "THONGDEE" },
    { key: "suda", cmuAccount: "suda_meechai@cmu.ac.th", studentId: "669999012", firstnameTh: "สุดา", lastnameTh: "มีชัย", firstnameEn: "SUDA", lastnameEn: "MEECHAI" },
    { key: "preecha", cmuAccount: "preecha_rungrueang@cmu.ac.th", studentId: "669999013", firstnameTh: "ปรีชา", lastnameTh: "รุ่งเรือง", firstnameEn: "PREECHA", lastnameEn: "RUNGRUEANG" },
    { key: "nongnuch", cmuAccount: "nongnuch_boonma@cmu.ac.th", studentId: "669999014", firstnameTh: "นงนุช", lastnameTh: "บุญมา", firstnameEn: "NONGNUCH", lastnameEn: "BOONMA" },
    { key: "chaiwat", cmuAccount: "chaiwat_promma@cmu.ac.th", studentId: "669999015", firstnameTh: "ชัยวัฒน์", lastnameTh: "พรหมมา", firstnameEn: "CHAIWAT", lastnameEn: "PROMMA" },
    { key: "ploy", cmuAccount: "ploypailin_sukjai@cmu.ac.th", studentId: "669999016", firstnameTh: "พลอยไพลิน", lastnameTh: "สุขใจ", firstnameEn: "PLOYPAILIN", lastnameEn: "SUKJAI" },
    { key: "tawan", cmuAccount: "tawan_inkaew@cmu.ac.th", studentId: "669999017", firstnameTh: "ตะวัน", lastnameTh: "อินทร์แก้ว", firstnameEn: "TAWAN", lastnameEn: "INKAEW" },
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

  // Alpha และ Beta ต้องมีที่ว่างเหลือให้ patiphan ทดสอบการเข้ากลุ่ม
  const [alpha, beta, gamma, delta, epsilon] = await dbClient
    .insert(groupsTable)
    .values([
      { courseId: course.id, name: "Team Alpha", maxMembers: 4, contractText },
      { courseId: course.id, name: "Team Beta", maxMembers: 3, contractText },
      { courseId: course.id, name: "Team Gamma", maxMembers: 4, contractText },
      { courseId: course.id, name: "Team Delta", maxMembers: 4, contractText },
      { courseId: course.id, name: "Team Epsilon", maxMembers: 3, contractText },
    ])
    .returning();

  // patiphan ไม่มีกลุ่ม (ทดสอบเข้ากลุ่ม), ธนพลไม่ได้ส่งรอบ 1, Beta ยังไม่ยอมรับข้อตกลง
  const members: [string, typeof alpha][] = [
    ["somchai", alpha],
    ["somying", alpha],
    ["thanapon", alpha],
    ["malee", beta],
    ["kittipong", beta],
    ["napat", gamma],
    ["pimchanok", gamma],
    ["wirat", gamma],
    ["kanya", gamma],
    ["anan", delta],
    ["suda", delta],
    ["preecha", delta],
    ["nongnuch", delta],
    ["chaiwat", epsilon],
    ["ploy", epsilon],
    ["tawan", epsilon],
  ];
  await dbClient.insert(groupMembersTable).values(
    members.map(([key, group]) => ({
      groupId: group.id,
      courseId: course.id,
      userId: byKey[key].id,
      joinedAt: daysFromNow(-40),
      contractAcceptedAt: group === beta ? null : daysFromNow(-39),
    }))
  );

  // รอบ 1 เผยแพร่แล้ว, รอบ 2 ปิดรับแล้วแต่ยังไม่เผยแพร่, รอบ 3 เปิดรับอยู่
  const [round1, round2, round3] = await dbClient
    .insert(roundsTable)
    .values([
      {
        courseId: course.id,
        sequenceNo: 1,
        opensAt: daysFromNow(-35),
        closesAt: daysFromNow(-28),
        scoresReleasedAt: daysFromNow(-24),
        feedbackReleasedAt: daysFromNow(-24),
      },
      {
        courseId: course.id,
        sequenceNo: 2,
        opensAt: daysFromNow(-14),
        closesAt: daysFromNow(-7),
      },
      {
        courseId: course.id,
        sequenceNo: 3,
        opensAt: daysFromNow(-1),
        closesAt: daysFromNow(6),
      },
    ])
    .returning();

  const questions = await dbClient.insert(questionsTable).values(RUBRIC).returning();

  // ทุกคนที่มีคำตอบใน seed ต้องมี consent (backend บังคับตอนส่ง)
  const consentKeys = new Set([
    ...Object.keys(ROUND1),
    ...Object.keys(COURSE2_ROUND1),
    ...Object.keys(DEMO_ROUND1),
  ]);
  await dbClient.insert(consentsTable).values(
    [...consentKeys].map((key) => ({
      userId: byKey[key].id,
      policyVersion: CONSENT_POLICY_VERSION,
      acceptedAt: daysFromNow(-39),
    }))
  );

  const groupIdOf = (key: string) => members.find(([k]) => k === key)![1].id;
  await insertRoundAnswers({
    roundId: round1.id,
    answers: ROUND1,
    groupIdOf,
    byKey,
    questions,
    submittedAt: daysFromNow(-30),
  });

  const demoRound1 = withComments(DEMO_ROUND1);
  demoRound1.nongnuch.preecha[1][1] = "ไม่เคยทำงานเลย เป็นตัวถ่วงของทีม";
  const demoSubmissions = await insertRoundAnswers({
    roundId: round1.id,
    answers: demoRound1,
    groupIdOf,
    byKey,
    questions,
    submittedAt: daysFromNow(-29),
  });
  // ไม่เก็บข้อความที่ถูกเตือน เก็บแค่ว่าผู้เขียนเลือกส่งตามเดิม
  await dbClient.insert(flagsTable).values({
    submissionId: demoSubmissions.nongnuch,
    questionId: questions.find((q) => q.type === "text" && q.orderNo === 7)!.id,
    evaluateeId: byKey.preecha.id,
    category: "personal_attack",
    severity: "medium",
    aiSuggestion: "งานส่วนที่รับไปยังไม่เสร็จหลายครั้ง อยากให้บอกทีมเร็วขึ้นถ้าทำไม่ทัน",
    studentAction: "ignored",
    modelVersion: "seed",
  });

  // รอบ 2 ส่งครบทุกคน (รวมธนพล) — ธนพลกับปรีชาได้คะแนนจากเพื่อนดีขึ้น, ชัยวัฒน์ให้ตัวเองสูงขึ้น, กิตติพงษ์ให้ตัวเองลดลง
  const round1Scores: Record<string, Record<string, Scores>> = { ...DEMO_ROUND1 };
  for (const [evaluator, targets] of Object.entries(ROUND1))
    round1Scores[evaluator] = Object.fromEntries(Object.entries(targets).map(([target, [scores]]) => [target, scores]));
  round1Scores.thanapon = { thanapon: [3, 3, 3, 3, 3], somchai: [5, 4, 5, 4, 5], somying: [4, 4, 4, 4, 4] };
  await insertRoundAnswers({
    roundId: round2.id,
    answers: withComments(
      nextRound(round1Scores, { peer: { thanapon: 1, preecha: 1 }, self: { chaiwat: 1, kittipong: -1 } })
    ),
    groupIdOf,
    byKey,
    questions,
    submittedAt: daysFromNow(-9),
  });

  await insertRoundAnswers({
    roundId: round3.id,
    answers: withComments(DEMO_OPEN_ROUND),
    groupIdOf,
    byKey,
    questions,
    submittedAt: daysFromNow(0),
  });

  const [course2] = await dbClient
    .insert(coursesTable)
    .values({
      courseCode: "261492",
      title: "Software Engineering",
      section: "001",
      semester: 1,
      academicYear: 2569,
      createdBy: instructor.id,
    })
    .returning();
  const course2Students = ["patiphan", "somying", "kittipong"];
  await dbClient.insert(enrollmentsTable).values([
    { courseId: course2.id, userId: instructor.id, role: "instructor" },
    ...course2Students.map((key) => ({ courseId: course2.id, userId: byKey[key].id, role: "student" as const })),
  ]);
  const [orion] = await dbClient
    .insert(groupsTable)
    .values({ courseId: course2.id, name: "Team Orion", maxMembers: 4, contractText })
    .returning();
  await dbClient.insert(groupMembersTable).values(
    course2Students.map((key) => ({
      groupId: orion.id,
      courseId: course2.id,
      userId: byKey[key].id,
      joinedAt: daysFromNow(-30),
      contractAcceptedAt: daysFromNow(-29),
    }))
  );
  const [c2round1, c2round2] = await dbClient
    .insert(roundsTable)
    .values([
      {
        courseId: course2.id,
        sequenceNo: 1,
        opensAt: daysFromNow(-20),
        closesAt: daysFromNow(-13),
        scoresReleasedAt: daysFromNow(-8),
        feedbackReleasedAt: daysFromNow(-8),
      },
      { courseId: course2.id, sequenceNo: 2, opensAt: daysFromNow(-2), closesAt: daysFromNow(5) },
    ])
    .returning();
  await insertRoundAnswers({
    roundId: c2round1.id,
    answers: COURSE2_ROUND1,
    groupIdOf: () => orion.id,
    byKey,
    questions,
    submittedAt: daysFromNow(-15),
  });

  console.log({
    instructor: `${instructor.cmuAccount} (${instructor.id})`,
    students: students.map((s) => `${s.cmuAccount} ${s.studentId} (${s.id})`),
    course: `${course.courseCode} sec ${course.section} ${course.semester}/${course.academicYear} (${course.id})`,
    groups: [alpha, beta, gamma, delta, epsilon].map((g) => `${g.name} (${g.id})`),
    rounds: [round1, round2, round3].map(
      (r) => `#${r.sequenceNo} ${r.opensAt.toISOString()} → ${r.closesAt.toISOString()}`
    ),
    questions: questions.length,
    round1Submissions: Object.keys(ROUND1).length,
    course2: `${course2.courseCode} ${course2.title} — ${orion.name}, rounds #${c2round1.sequenceNo} (released) #${c2round2.sequenceNo} (open)`,
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
