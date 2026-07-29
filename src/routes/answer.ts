import { dbClient } from "@db/client.js";
import {
  answersTable,
  groupMembersTable,
  groupsTable,
  questionsTable,
  roundsTable,
} from "@db/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { authenticate, type AuthedRequest } from "../middlewares/auth.middleware.js";

const router = Router();

// POST /answers — ส่งคำตอบทั้งชุดของผู้ถูกประเมิน 1 คน (ตนเองหรือเพื่อน)
router.post("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const evaluatorId = req.user!.id;
    const roundId = req.body.roundId ?? "";
    const groupId = req.body.groupId ?? "";
    const evaluateeId = req.body.evaluateeId ?? "";
    const items: {
      questionId: string;
      scoreValue?: number;
      textValue?: string;
    }[] = req.body.answers ?? [];

    if (!roundId || !groupId || !evaluateeId || items.length === 0)
      throw new Error("roundId, groupId, evaluateeId and answers are required");

    // 1) แบบประเมินต้องเปิดอยู่
    const [round] = await dbClient
      .select()
      .from(roundsTable)
      .where(eq(roundsTable.id, roundId));
    if (!round) throw new Error("Invalid roundId");
    if (!round.isOpen) throw new Error("แบบประเมินนี้ปิดรับคำตอบแล้ว");

    // 1.5) กลุ่มต้องอยู่ใน course เดียวกับ round
    const [group] = await dbClient
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId));
    if (!group) throw new Error("Invalid groupId");
    if (group.courseId !== round.courseId)
      throw new Error("กลุ่มนี้ไม่ได้อยู่ในวิชาเดียวกับแบบประเมิน");

    // 2) ทั้งผู้ประเมินและผู้ถูกประเมินต้องอยู่ในกลุ่มนี้จริง
    const members = await dbClient
      .select({ userId: groupMembersTable.userId })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, groupId));
    const memberIds = members.map((m) => m.userId);

    if (!memberIds.includes(evaluatorId))
      throw new Error("คุณไม่ได้อยู่ในกลุ่มนี้");
    if (!memberIds.includes(evaluateeId))
      throw new Error("ผู้ถูกประเมินไม่ได้อยู่ในกลุ่มนี้");

    // 3) คำถามต้องอยู่ในแบบประเมินนี้ และชนิดคำตอบต้องตรงกับชนิดคำถาม
    const questions = await dbClient
      .select()
      .from(questionsTable)
      .where(eq(questionsTable.roundId, roundId));

    const questionMap: Record<string, (typeof questions)[number]> = {};
    questions.forEach((q) => (questionMap[q.id] = q));

    const values = items.map((item) => {
      const q = questionMap[item.questionId];
      if (!q) throw new Error("พบคำถามที่ไม่ได้อยู่ในรอบนี้");

      if (q.type === "scale") {
        const score = item.scoreValue;
        if (typeof score !== "number" || score < 1 || score > 5)
          throw new Error(`"${q.content}" ต้องให้คะแนน 1-5`);
        return {
          questionId: q.id,
          groupId,
          evaluatorId,
          evaluateeId,
          scoreValue: score,
          textValue: null,
        };
      }

      const text = (item.textValue ?? "").trim();
      if (!text) throw new Error(`"${q.content}" ต้องเขียนคำตอบ`);
      return {
        questionId: q.id,
        groupId,
        evaluatorId,
        evaluateeId,
        scoreValue: null,
        textValue: text,
      };
    });

    // 4) แก้ไขคำตอบเดิมได้ตราบใดที่แบบประเมินยังเปิด (ลบชุดเก่าแล้วใส่ใหม่)
    const results = await dbClient.transaction(async (tx) => {
      await tx.delete(answersTable).where(
        and(
          eq(answersTable.evaluatorId, evaluatorId),
          eq(answersTable.evaluateeId, evaluateeId),
          inArray(
            answersTable.questionId,
            values.map((v) => v.questionId)
          )
        )
      );
      return tx.insert(answersTable).values(values).returning();
    });

    res.json({
      msg:
        evaluatorId === evaluateeId
          ? "บันทึกการประเมินตนเองเรียบร้อย"
          : "บันทึกการประเมินเพื่อนเรียบร้อย",
      data: results,
    });
  } catch (err) {
    next(err);
  }
});

// GET /answers/progress?roundId=&groupId= — ประเมินใครไปแล้วบ้าง
router.get("/progress", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const roundId = String(req.query.roundId ?? "");
    const groupId = String(req.query.groupId ?? "");
    if (!roundId || !groupId)
      throw new Error("roundId and groupId are required");

    const questions = await dbClient
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(eq(questionsTable.roundId, roundId));
    const questionIds = questions.map((q) => q.id);

    if (questionIds.length === 0)
      return res.json({ msg: "No questions in this round", data: [] });

    const rows = await dbClient
      .select({
        evaluateeId: answersTable.evaluateeId,
        questionId: answersTable.questionId,
      })
      .from(answersTable)
      .where(
        and(
          eq(answersTable.evaluatorId, req.user!.id),
          eq(answersTable.groupId, groupId),
          inArray(answersTable.questionId, questionIds)
        )
      );

    // นับว่าตอบครบทุกข้อของคนนั้นหรือยัง
    const countMap: Record<string, number> = {};
    rows.forEach((r) => {
      countMap[r.evaluateeId] = (countMap[r.evaluateeId] ?? 0) + 1;
    });

    const data = Object.entries(countMap).map(([evaluateeId, answered]) => ({
      evaluateeId,
      answered,
      total: questionIds.length,
      completed: answered >= questionIds.length,
    }));

    res.json({ msg: "Fetch progress successfully", data });
  } catch (err) {
    next(err);
  }
});

// GET /answers/mine?roundId=&evaluateeId= — ดึงคำตอบเดิมมาแก้
router.get("/mine", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const roundId = String(req.query.roundId ?? "");
    const evaluateeId = String(req.query.evaluateeId ?? "");
    if (!roundId || !evaluateeId)
      throw new Error("roundId and evaluateeId are required");

    const questions = await dbClient
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(eq(questionsTable.roundId, roundId));
    const questionIds = questions.map((q) => q.id);

    if (questionIds.length === 0)
      return res.json({ msg: "No questions", data: [] });

    const results = await dbClient
      .select()
      .from(answersTable)
      .where(
        and(
          eq(answersTable.evaluatorId, req.user!.id),
          eq(answersTable.evaluateeId, evaluateeId),
          inArray(answersTable.questionId, questionIds)
        )
      );

    res.json({ msg: "Fetch my answers successfully", data: results });
  } catch (err) {
    next(err);
  }
});

export default router;