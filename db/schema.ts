import {
  pgTable,
  timestamp,
  uuid,
  varchar,
  integer,
  text,
  boolean,
  unique,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).default("student").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const coursesTable = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseCode: varchar("course_code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ใครลงทะเบียนเรียนวิชาอะไร (1 คน หลายวิชาได้)
export const enrollmentsTable = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => usersTable.id)
      .notNull(),
    courseId: uuid("course_id")
      .references(() => coursesTable.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqEnrollment: unique().on(table.userId, table.courseId),
  })
);

export const groupsTable = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  courseId: uuid("course_id")
    .references(() => coursesTable.id)
    .notNull(),
  section: varchar("section", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ใครอยู่กลุ่มไหน (1 คน อยู่ได้หลายกลุ่ม ต่างวิชากัน)
export const groupMembersTable = pgTable(
  "group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .references(() => groupsTable.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => usersTable.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqMember: unique().on(table.groupId, table.userId),
  })
);

// แบบประเมิน — อาจารย์เปิด/ปิดได้
export const roundsTable = pgTable("rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .references(() => coursesTable.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isOpen: boolean("is_open").default(false).notNull(),
  opensAt: timestamp("opens_at"),
  closesAt: timestamp("closes_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// คำถามในรอบ — scale (1-5) หรือ text (ข้อความยาว)
export const questionsTable = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roundId: uuid("round_id")
    .references(() => roundsTable.id)
    .notNull(),
  content: text("content").notNull(),
  type: varchar("type", { length: 20 }).default("scale").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// คำตอบรายข้อ — evaluatorId = evaluateeId คือประเมินตนเอง
export const answersTable = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .references(() => questionsTable.id)
      .notNull(),
    groupId: uuid("group_id")
      .references(() => groupsTable.id)
      .notNull(),
    evaluatorId: uuid("evaluator_id")
      .references(() => usersTable.id)
      .notNull(),
    evaluateeId: uuid("evaluatee_id")
      .references(() => usersTable.id)
      .notNull(),
    scoreValue: integer("score_value"),
    textValue: text("text_value"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqAnswer: unique().on(
      table.questionId,
      table.evaluatorId,
      table.evaluateeId
    ),
  })
);

// สรุปฟีดแบ็กจากอาจารย์ — แยกตามรอบ
export const feedbackSummariesTable = pgTable(
  "feedback_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .references(() => roundsTable.id)
      .notNull(),
    studentId: uuid("student_id")
      .references(() => usersTable.id)
      .notNull(),
    instructorId: uuid("instructor_id")
      .references(() => usersTable.id)
      .notNull(),
    summary: text("summary").notNull(),
    isPublished: boolean("is_published").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 }).$onUpdate(
      () => new Date()
    ),
  },
  (table) => ({
    uniqSummary: unique().on(table.roundId, table.studentId),
  })
);