import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  timestamp,
  uuid,
  varchar,
  smallint,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const enrollmentRoleEnum = pgEnum("enrollment_role", [
  "instructor",
  "student",
]);

export const accountTypeEnum = pgEnum("account_type", ["StdAcc", "MISEmpAcc"]);

export const questionTypeEnum = pgEnum("question_type", ["rating", "text"]);

export const submissionStatusEnum = pgEnum("submission_status", [
  "draft",
  "submitted",
]);

export const flagCategoryEnum = pgEnum("flag_category", [
  "profanity",
  "personal_attack",
  "negative_tone",
  "other",
]);

export const flagSeverityEnum = pgEnum("flag_severity", [
  "low",
  "medium",
  "high",
]);

export const studentActionEnum = pgEnum("student_action", [
  "pending",
  "edited",
  "ignored",
]);

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // email @cmu.ac.th ใช้ match ตอน login
  cmuAccount: varchar("cmu_account").notNull().unique(),
  // null สำหรับอาจารย์
  studentId: varchar("student_id").unique(),
  firstnameTh: varchar("firstname_th"),
  lastnameTh: varchar("lastname_th"),
  firstnameEn: varchar("firstname_en"),
  lastnameEn: varchar("lastname_en"),
  accountType: accountTypeEnum("account_type"),
  // null = import แล้วแต่ยังไม่เคย login
  firstLoginAt: timestamp("first_login_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const coursesTable = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // เช่น 261497
    courseCode: varchar("course_code").notNull(),
    title: varchar("title").notNull(),
    section: varchar("section"),
    semester: smallint("semester").notNull(),
    academicYear: smallint("academic_year").notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique().on(
      table.courseCode,
      table.section,
      table.semester,
      table.academicYear
    ),
  ]
);

// ใครอยู่วิชาไหน ในบทบาทอะไร
export const enrollmentsTable = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .references(() => coursesTable.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => usersTable.id)
      .notNull(),
    role: enrollmentRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.courseId, table.userId)]
);

export const groupsTable = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .references(() => coursesTable.id)
    .notNull(),
  name: varchar("name").notNull(),
  maxMembers: smallint("max_members"),
  // Contract/Rules
  contractText: text("contract_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ใครอยู่กลุ่มไหน — ออกทีมเป็น soft delete (left_at)
// 1 คนอยู่ได้แค่ 1 กลุ่มที่ยัง active ต่อวิชา
export const groupMembersTable = pgTable(
  "group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .references(() => groupsTable.id)
      .notNull(),
    courseId: uuid("course_id")
      .references(() => coursesTable.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => usersTable.id)
      .notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    contractAcceptedAt: timestamp("contract_accepted_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex("group_members_course_id_user_id_active_idx")
      .on(table.courseId, table.userId)
      .where(sql`${table.leftAt} IS NULL`),
  ]
);

// รอบประเมิน — เปิด/ปิดตาม opens_at/closes_at, released_at null = ซ่อน
export const roundsTable = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .references(() => coursesTable.id)
      .notNull(),
    sequenceNo: smallint("sequence_no").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    scaleMin: smallint("scale_min").default(1).notNull(),
    scaleMax: smallint("scale_max").default(5).notNull(),
    scoresReleasedAt: timestamp("scores_released_at", { withTimezone: true }),
    feedbackReleasedAt: timestamp("feedback_released_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.courseId, table.sequenceNo)]
);

// ชุดคำถามมาตรฐาน seed ไว้ อาจารย์ยังสร้างเองไม่ได้ (Rubric Builder อยู่ P2)
export const questionsTable = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: smallint("order_no").notNull(),
  type: questionTypeEnum("type").notNull(),
  prompt: text("prompt").notNull(),
});

// การส่งแบบประเมิน 1 ครั้งต่อ evaluator ต่อรอบ
export const submissionsTable = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .references(() => roundsTable.id)
      .notNull(),
    groupId: uuid("group_id")
      .references(() => groupsTable.id)
      .notNull(),
    evaluatorId: uuid("evaluator_id")
      .references(() => usersTable.id)
      .notNull(),
    status: submissionStatusEnum("status").default("draft").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.roundId, table.evaluatorId)]
);

// คำตอบรายข้อต่อ evaluatee — evaluator (จาก submission) = evaluatee คือประเมินตนเอง
export const ratingsTable = pgTable("ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .references(() => submissionsTable.id)
    .notNull(),
  questionId: uuid("question_id")
    .references(() => questionsTable.id)
    .notNull(),
  evaluateeId: uuid("evaluatee_id")
    .references(() => usersTable.id)
    .notNull(),
  score: smallint("score"),
  comment: text("comment"),
});

// AI ตรวจข้อความก่อนส่ง ไม่เก็บ draft ที่ถูกลบทิ้ง
export const flagsTable = pgTable("flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .references(() => submissionsTable.id)
    .notNull(),
  questionId: uuid("question_id")
    .references(() => questionsTable.id)
    .notNull(),
  evaluateeId: uuid("evaluatee_id").references(() => usersTable.id),
  category: flagCategoryEnum("category").notNull(),
  severity: flagSeverityEnum("severity").notNull(),
  aiSuggestion: text("ai_suggestion"),
  studentAction: studentActionEnum("student_action")
    .default("pending")
    .notNull(),
  modelVersion: varchar("model_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
