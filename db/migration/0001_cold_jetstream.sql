CREATE TYPE "public"."account_type" AS ENUM('StdAcc', 'MISEmpAcc');--> statement-breakpoint
CREATE TYPE "public"."enrollment_role" AS ENUM('instructor', 'student');--> statement-breakpoint
CREATE TYPE "public"."flag_category" AS ENUM('profanity', 'personal_attack', 'negative_tone', 'other');--> statement-breakpoint
CREATE TYPE "public"."flag_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('rating', 'text');--> statement-breakpoint
CREATE TYPE "public"."student_action" AS ENUM('pending', 'edited', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"evaluatee_id" uuid,
	"category" "flag_category" NOT NULL,
	"severity" "flag_severity" NOT NULL,
	"ai_suggestion" text,
	"student_action" "student_action" DEFAULT 'pending' NOT NULL,
	"model_version" varchar,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"evaluatee_id" uuid NOT NULL,
	"score" smallint,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"evaluator_id" uuid NOT NULL,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "submissions_round_id_evaluator_id_unique" UNIQUE("round_id","evaluator_id")
);
--> statement-breakpoint
ALTER TABLE "answers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_summaries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "answers" CASCADE;--> statement-breakpoint
DROP TABLE "feedback_summaries" CASCADE;--> statement-breakpoint
ALTER TABLE "courses" DROP CONSTRAINT "courses_course_code_unique";--> statement-breakpoint
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_user_id_course_id_unique";--> statement-breakpoint
ALTER TABLE "group_members" DROP CONSTRAINT "group_members_group_id_user_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "questions" DROP CONSTRAINT "questions_round_id_rounds_id_fk";
--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "course_code" SET DATA TYPE varchar;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollments" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrollments" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "enrollments" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "name" SET DATA TYPE varchar;--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "type" SET DATA TYPE "public"."question_type" USING "type"::"public"."question_type";--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "opens_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "opens_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "closes_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "closes_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "title" varchar NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "section" varchar;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "semester" smallint NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "academic_year" smallint NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "role" "enrollment_role" NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "course_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "joined_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "contract_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "max_members" smallint;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "contract_text" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "order_no" smallint NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "prompt" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "sequence_no" smallint NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "scale_min" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "scale_max" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "scores_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "feedback_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cmu_account" varchar NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firstname_th" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lastname_th" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firstname_en" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lastname_en" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_type" "account_type";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_evaluatee_id_users_id_fk" FOREIGN KEY ("evaluatee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_evaluatee_id_users_id_fk" FOREIGN KEY ("evaluatee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_evaluator_id_users_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_course_id_user_id_active_idx" ON "group_members" USING btree ("course_id","user_id") WHERE "group_members"."left_at" IS NULL;--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "group_members" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "groups" DROP COLUMN "section";--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN "round_id";--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN "sort_order";--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "is_open";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_course_code_section_semester_academic_year_unique" UNIQUE("course_code","section","semester","academic_year");--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_user_id_unique" UNIQUE("course_id","user_id");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_course_id_sequence_no_unique" UNIQUE("course_id","sequence_no");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_cmu_account_unique" UNIQUE("cmu_account");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_student_id_unique" UNIQUE("student_id");