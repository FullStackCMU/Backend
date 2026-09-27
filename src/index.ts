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
import userRoute from "./routes/user.ts";


const debug = Debug("pf-backend");

if (!process.env.JWT_SECRET)
  throw new Error("JWT_SECRET is not defined in .env");

// Initializing the express app
const app = express();

//Middleware
app.use(morgan("dev", { immediate: false }));
app.use(helmet());
// app.use(
//   cors({
//     origin: false, // Disable CORS
//   }),
// );
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:5173"],
    credentials: true,
  }),
);

app.use(express.json());

// Routes
app.use("/auth", authRoute);
app.use("/consents", consentRoute);
app.use("/users", userRoute);
app.use("/courses", courseRoute);
app.use("/groups", groupRoute);
app.use("/rounds", roundRoute);
app.use("/answers", answerRoute);
app.use("/feedback", feedbackRoute);

// ห้ามส่งข้อความดิบ stack ของ DB กลับ client เพราะเปิดเผยชื่อ table/column ภายใน
const PG_MESSAGE: Record<string, string> = {
  "23505": "ข้อมูลนี้มีอยู่แล้วในระบบ", // unique_violation
  "23503": "อ้างอิงข้อมูลที่ไม่มีอยู่จริง", // foreign_key_violation
  "23502": "ข้อมูลไม่ครบตามที่กำหนด", // not_null_violation
  "22P02": "รูปแบบข้อมูลไม่ถูกต้อง", // invalid_text_representation
};

const jsonErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  debug(err.message); // log ข้อความจริงไว้ฝั่ง server เสมอ

  const pgCode =
    (typeof err.code === "string" ? err.code : undefined) ??
    (err.cause && typeof err.cause.code === "string"
      ? err.cause.code
      : undefined);
  const isDbError = !!pgCode || err.name === "DrizzleQueryError";

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

  // รายการปัญหารายข้อ (เช่น ข้อความที่ AI flagger ให้แก้ก่อนส่ง)
  if (Array.isArray(err.issues)) errorResponse.issues = err.issues;

  if (process.env.NODE_ENV === "development" && !isDbError) {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};
app.use(jsonErrorHandler);

// Running app
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  debug(`Listening on port ${PORT}: http://localhost:${PORT}`);
});