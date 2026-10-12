CREATE TABLE "instructor_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "instructor_notes_round_id_student_id_unique" UNIQUE("round_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "instructor_notes" ADD CONSTRAINT "instructor_notes_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_notes" ADD CONSTRAINT "instructor_notes_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_notes" ADD CONSTRAINT "instructor_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;