CREATE TABLE "job_runs" (
	"job" text NOT NULL,
	"run_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_runs_job_run_key_pk" PRIMARY KEY("job","run_key")
);
--> statement-breakpoint
ALTER TABLE "persona_memory" ADD COLUMN "pending_posts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "history" text;