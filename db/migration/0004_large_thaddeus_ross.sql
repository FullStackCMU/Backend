CREATE TYPE "public"."question_focus" AS ENUM('task', 'team');--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "focus" "question_focus";