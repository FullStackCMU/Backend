import { dbClient } from "@db/client.js";
import { coursesTable, enrollmentsTable } from "@db/schema.js";
import { eq } from "drizzle-orm";
import { Router } from "express";
import {
  authenticate,
  requireInstructor,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();

// POST /courses — อาจารย์สร้างรายวิชา
router.post("/", authenticate, requireInstructor, async (req, res, next) => {
  try {
    const courseCode = req.body.courseCode ?? "";
    const name = req.body.name ?? "";
    if (!courseCode || !name)
      throw new Error("courseCode and name are required");

    const [result] = await dbClient
      .insert(coursesTable)
      .values({ courseCode, name })
      .returning();

    res.json({ msg: "Insert course successfully", data: result });
  } catch (err) {
    next(err);
  }
});

// GET /courses/my — วิชาที่ฉันเรียน
router.get("/my", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const results = await dbClient
      .select({
        id: coursesTable.id,
        courseCode: coursesTable.courseCode,
        name: coursesTable.name,
        createdAt: coursesTable.createdAt,
      })
      .from(enrollmentsTable)
      .innerJoin(coursesTable, eq(coursesTable.id, enrollmentsTable.courseId))
      .where(eq(enrollmentsTable.userId, req.user!.id));

    res.json({ msg: "Fetch my courses successfully", data: results });
  } catch (err) {
    next(err);
  }
});

// GET /courses — รายวิชาทั้งหมด
router.get("/", authenticate, async (req, res, next) => {
  try {
    const results = await dbClient.select().from(coursesTable);
    res.json({ msg: "Fetch courses successfully", data: results });
  } catch (err) {
    next(err);
  }
});

// POST /courses/:id/enroll — อาจารย์ลงทะเบียนนักศึกษาเข้าวิชา
router.post(
  "/:id/enroll",
  authenticate,
  requireInstructor,
  async (req, res, next) => {
    try {
      const courseId = String(req.params.id);
      const userIds: string[] = req.body.userIds ?? [];
      if (userIds.length === 0) throw new Error("userIds is required");

      const results = await dbClient
        .insert(enrollmentsTable)
        .values(userIds.map((userId) => ({ userId, courseId })))
        .onConflictDoNothing()
        .returning();

      res.json({ msg: "Enroll successfully", data: results });
    } catch (err) {
      next(err);
    }
  }
);

export default router;