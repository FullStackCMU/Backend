import "dotenv/config";
import cors from "cors";
import Debug from "debug";
import type { ErrorRequestHandler } from "express";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import answerRoute from "./routes/answer.ts";
import authRoute from "./routes/auth.ts";
import consentRoute from "./routes/consent.ts";
import courseRoute from "./routes/course.ts";
import feedbackRoute from "./routes/feedback.ts";
import groupRoute from "./routes/group.ts";
import roundRoute from "./routes/round.ts";

const debug = Debug("pf-backend");

if (!process.env.JWT_SECRET)
  throw new Error("JWT_SECRET is not defined in .env");

const app = express();

app.use(morgan("dev", { immediate: false }));
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:5173"],
    credentials: true,
  }),
);

app.use(express.json());

app.use("/auth", authRoute);
app.use("/consents", consentRoute);
app.use("/courses", courseRoute);
app.use("/groups", groupRoute);
app.use("/rounds", roundRoute);
app.use("/answers", answerRoute);
app.use("/feedback", feedbackRoute);

// ห้ามส่งข้อความ error ของ DB กลับ client — เปิดเผยชื่อ table/column
const PG_MESSAGE: Record<string, string> = {
  "23505": "ข้อมูลนี้มีอยู่แล้วในระบบ",
  "23503": "อ้างอิงข้อมูลที่ไม่มีอยู่จริง",
  "23502": "ข้อมูลไม่ครบตามที่กำหนด",
  "22P02": "รูปแบบข้อมูลไม่ถูกต้อง", // invalid_text_representation
};

const jsonErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const pgCode =
    (typeof err.code === "string" ? err.code : undefined) ??
    (err.cause && typeof err.cause.code === "string"
      ? err.cause.code
      : undefined);
  const isDbError = !!pgCode || err.name === "DrizzleQueryError";

  // ห้าม log message ของ DB error — Drizzle แนบ params (ความเห็นนักศึกษา) มาด้วย
  debug(isDbError ? `DB error ${pgCode ?? err.name} on ${req.method} ${req.path}` : err.message);

  let statusCode: number;
  let message: string;

  if (isDbError) {
    statusCode = 400;
    message = (pgCode && PG_MESSAGE[pgCode]) || "คำขอไม่ถูกต้อง";
  } else {
    statusCode = err.statusCode ?? (err.message ? 400 : 500);
    message = err.message || "Internal Server Error";
  }

  const errorResponse: Record<string, unknown> = {
    message,
    type: isDbError ? "Error" : err.name || "Error",
  };

  if (process.env.NODE_ENV === "development" && !isDbError) {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};
app.use(jsonErrorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  debug(`Listening on port ${PORT}: http://localhost:${PORT}`);
});