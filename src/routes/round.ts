import { dbClient } from "@db/client.js";
import { questionsTable, roundsTable } from "@db/schema.js";
import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import {
  authenticate,
  requireInstructor,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

// POST /rounds — อาจารย์สร้างแบบประเมิน
router.post("/", authenticate, requireInstructor, async (req, res, next) => {
  try {
    const courseId = req.body.courseId ?? "";
    const name = req.body.name ?? "";
    const description = req.body.description ?? null;
    const isOpen = req.body.isOpen ?? false;

    if (!courseId || !name) throw new Error("courseId and name are required");
    if (typeof isOpen !== "boolean") throw new Error("isOpen must be a boolean");

    const [round] = await dbClient
      .insert(roundsTable)
      .values({ courseId, name, description, isOpen })
      .returning();

    res.json({ msg: "Insert round successfully", data: round });
  } catch (err) {
    next(err);
  }
});

// GET /rounds?courseId=... — นักศึกษาเห็นเฉพาะปบบประเมินที่เปิด, อาจารย์เห็นทั้งหมด
router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const courseId = String(req.query.courseId ?? "");
    if (!courseId) throw new Error("courseId is required");

    // นักศึกษาเห็นเฉพาะแบบประเมินที่เปิด
    const isInstructor = req.user!.role === "instructor";
    const rows = await dbClient
      .select()
      .from(roundsTable)
      .where(
        isInstructor
          ? eq(roundsTable.courseId, courseId)
          : and(
            eq(roundsTable.courseId, courseId),
            eq(roundsTable.isOpen, true)
          )
      )
      .orderBy(asc(roundsTable.createdAt));

    res.json({ msg: "Fetch rounds successfully", data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /rounds/:id/questions — ดึงคำถามในแบบประเมิน
router.get(
  "/:id/questions",
  authenticate,
  async (req: AuthedRequest, res, next) => {
    try {
      const roundId = String(req.params.id);

      const [round] = await dbClient
        .select()
        .from(roundsTable)
        .where(eq(roundsTable.id, roundId));
      if (!round) throw new Error("Invalid id");

      // นักศึกษาเห็นคำถามได้เฉพาะแบบประเมินที่เปิดอยู่ อาจารย์เห็นได้ทุกรอบ
      if (!round.isOpen && req.user!.role !== "instructor") {
        const err: any = new Error("แบบประเมินนี้ยังไม่เปิด");
        err.statusCode = 403;
        throw err;
      }

      const results = await dbClient
        .select()
        .from(questionsTable)
        .where(eq(questionsTable.roundId, roundId))
        .orderBy(asc(questionsTable.sortOrder));

      res.json({ msg: "Fetch questions successfully", data: results });
    } catch (err) {
      next(err);
    }
  }
);

// POST /rounds/:id/questions — อาจารย์เพิ่มคำถาม (ทีละข้อหรือหลายข้อพร้อมกัน)
router.post(
  "/:id/questions",
  authenticate,
  requireInstructor,
  async (req, res, next) => {
    try {
      const roundId = String(req.params.id);
      const items = Array.isArray(req.body) ? req.body : [req.body];

      const values = items.map((q, idx) => {
        const content = q.content ?? "";
        const type = q.type ?? "scale";
        if (!content) throw new Error("content is required");
        if (type !== "scale" && type !== "text")
          throw new Error("type must be 'scale' or 'text'");
        return {
          roundId,
          content,
          type,
          sortOrder: q.sortOrder ?? idx + 1,
        };
      });

      const results = await dbClient
        .insert(questionsTable)
        .values(values)
        .returning();

      res.json({ msg: "Insert questions successfully", data: results });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /rounds/:id/open — เปิด/ปิดแบบประเมิน
router.patch(
  "/:id/open",
  authenticate,
  requireInstructor,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const isOpen = req.body.isOpen;

      if (typeof isOpen !== "boolean")
        throw new Error("isOpen must be a boolean");

      const [updated] = await dbClient
        .update(roundsTable)
        .set({ isOpen })
        .where(eq(roundsTable.id, id))
        .returning();

      if (!updated) throw new Error("Invalid id");

      res.json({
        msg: `Round ${isOpen ? "opened" : "closed"}`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /rounds/questions/:questionId — ลบคำถาม
router.delete(
  "/questions/:questionId",
  authenticate,
  requireInstructor,
  async (req, res, next) => {
    try {
      const questionId = String(req.params.questionId);

      const [deleted] = await dbClient
        .delete(questionsTable)
        .where(eq(questionsTable.id, questionId))
        .returning();

      if (!deleted) throw new Error("Invalid id");

      res.json({ msg: "Delete question successfully", data: { id: deleted.id } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;