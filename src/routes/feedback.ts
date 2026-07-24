import { dbClient } from "@db/client.js";
import {
  answersTable,
  feedbackSummariesTable,
  questionsTable,
  roundsTable,
  usersTable,
} from "@db/schema.js";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import {
  authenticate,
  requireInstructor,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

// GET /feedback/raw/:roundId?groupId= — อาจารย์อ่านคำตอบดิบทั้งหมด
router.get(
  "/raw/:roundId",
  authenticate,
  requireInstructor,
  async (req, res, next) => {
    try {
      const roundId = String(req.params.roundId);
      const groupId = String(req.query.groupId ?? "");
      if (!groupId) throw new Error("groupId is required");

      const results = await dbClient
        .select({
          answerId: answersTable.id,
          questionId: questionsTable.id,
          questionContent: questionsTable.content,
          questionType: questionsTable.type,
          sortOrder: questionsTable.sortOrder,
          scoreValue: answersTable.scoreValue,
          textValue: answersTable.textValue,
          evaluatorId: answersTable.evaluatorId,
          evaluateeId: answersTable.evaluateeId,
          evaluateeName: usersTable.name,
          createdAt: answersTable.createdAt,
        })
        .from(answersTable)
        .innerJoin(
          questionsTable,
          eq(questionsTable.id, answersTable.questionId)
        )
        .innerJoin(usersTable, eq(usersTable.id, answersTable.evaluateeId))
        .where(
          and(
            eq(questionsTable.roundId, roundId),
            eq(answersTable.groupId, groupId)
          )
        );

      res.json({ msg: "Fetch raw answers successfully", data: results });
    } catch (err) {
      next(err);
    }
  }
);

// POST /feedback — อาจารย์เขียน/แก้สรุป
router.post(
  "/",
  authenticate,
  requireInstructor,
  async (req: AuthedRequest, res, next) => {
    try {
      const instructorId = req.user!.id;
      const roundId = req.body.roundId ?? "";
      const studentId = req.body.studentId ?? "";
      const summary = req.body.summary ?? "";
      const isPublished = req.body.isPublished ?? false;

      if (!roundId || !studentId || !summary)
        throw new Error("roundId, studentId and summary are required");
      if (typeof isPublished !== "boolean")
        throw new Error("isPublished must be a boolean");

      const [result] = await dbClient
        .insert(feedbackSummariesTable)
        .values({ roundId, studentId, instructorId, summary, isPublished })
        .onConflictDoUpdate({
          target: [feedbackSummariesTable.roundId, feedbackSummariesTable.studentId],
          set: { summary, isPublished, instructorId },
        })
        .returning();

      res.json({ msg: "Upsert feedback successfully", data: result });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /feedback/:id/publish
router.patch(
  "/:id/publish",
  authenticate,
  requireInstructor,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const isPublished = req.body.isPublished;
      if (typeof isPublished !== "boolean")
        throw new Error("isPublished must be a boolean");

      const [updated] = await dbClient
        .update(feedbackSummariesTable)
        .set({ isPublished })
        .where(eq(feedbackSummariesTable.id, id))
        .returning();

      if (!updated) throw new Error("Invalid id");

      res.json({
        msg: `Feedback ${isPublished ? "published" : "unpublished"}`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /feedback/round/:roundId — อาจารย์ดูสรุปทั้งหมดในรอบ
router.get(
  "/round/:roundId",
  authenticate,
  requireInstructor,
  async (req, res, next) => {
    try {
      const roundId = String(req.params.roundId);

      const results = await dbClient
        .select({
          id: feedbackSummariesTable.id,
          studentId: feedbackSummariesTable.studentId,
          studentName: usersTable.name,
          summary: feedbackSummariesTable.summary,
          isPublished: feedbackSummariesTable.isPublished,
          createdAt: feedbackSummariesTable.createdAt,
        })
        .from(feedbackSummariesTable)
        .innerJoin(
          usersTable,
          eq(usersTable.id, feedbackSummariesTable.studentId)
        )
        .where(eq(feedbackSummariesTable.roundId, roundId));

      res.json({ msg: "Fetch summaries successfully", data: results });
    } catch (err) {
      next(err);
    }
  }
);

/// GET /feedback/me — นักศึกษาดูฟีดแบ็กที่เผยแพร่แล้ว (พร้อมชื่อแบบประเมินและวิชา)
router.get("/me", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const results = await dbClient
      .select({
        id: feedbackSummariesTable.id,
        roundId: feedbackSummariesTable.roundId,
        roundName: roundsTable.name,
        courseId: roundsTable.courseId,
        summary: feedbackSummariesTable.summary,
        createdAt: feedbackSummariesTable.createdAt,
      })
      .from(feedbackSummariesTable)
      .innerJoin(
        roundsTable,
        eq(roundsTable.id, feedbackSummariesTable.roundId)
      )
      .where(
        and(
          eq(feedbackSummariesTable.studentId, req.user!.id),
          eq(feedbackSummariesTable.isPublished, true)
        )
      );

    res.json({ msg: "Fetch your feedback successfully", data: results });
  } catch (err) {
    next(err);
  }
});

export default router;