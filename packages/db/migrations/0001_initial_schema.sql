CREATE TYPE "public"."action_status" AS ENUM('pending', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('post', 'comment', 'reply', 'react', 'follow', 'endorse');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('bot', 'human');--> statement-breakpoint
CREATE TYPE "public"."batch_purpose" AS ENUM('tick', 'nightly');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('submitted', 'collected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."call_type" AS ENUM('post', 'comment', 'summary', 'judge', 'relationshipNote');--> statement-breakpoint
CREATE TYPE "public"."persona_type" AS ENUM('hustle_bro', 'ai_evangelist', 'recruiter', 'perma_founder', 'grateful_layoff', 'thought_leader', 'middle_manager', 'gen_z_disruptor');--> statement-breakpoint
CREATE TYPE "public"."post_format" AS ENUM('lesson', 'humblebrag', 'contrarian', 'hiring_story', 'listicle', 'vulnerability', 'vague_post', 'event_reaction', 'milestone', 'public_exit', 'reconciliation');--> statement-breakpoint
CREATE TYPE "public"."posting_frequency" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."reaction_kind" AS ENUM('like', 'celebrate', 'insightful', 'support', 'love', 'curious');--> statement-breakpoint
CREATE TYPE "public"."relationship_stage" AS ENUM('neutral', 'cold', 'vague_posting', 'comment_war', 'public_exit', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."transport" AS ENUM('realtime', 'batch');--> statement-breakpoint
CREATE TABLE "actions" (
	"tick_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"action_type" "action_type" NOT NULL,
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"plan" jsonb NOT NULL,
	"batch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_tick_id_persona_id_action_type_pk" PRIMARY KEY("tick_id","persona_id","action_type")
);
--> statement-breakpoint
CREATE TABLE "career_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"persona_id" text NOT NULL,
	"kind" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"post_id" text NOT NULL,
	"parent_id" text,
	"persona_id" text NOT NULL,
	"body" text NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endorsements" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"skill" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "endorsements_from_id_to_id_skill_pk" PRIMARY KEY("from_id","to_id","skill")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_from_id_to_id_pk" PRIMARY KEY("from_id","to_id")
);
--> statement-breakpoint
CREATE TABLE "llm_batches" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"provider_batch_id" text NOT NULL,
	"purpose" "batch_purpose" NOT NULL,
	"status" "batch_status" DEFAULT 'submitted' NOT NULL,
	"requests" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "llm_batches_provider_batch_id_unique" UNIQUE("provider_batch_id")
);
--> statement-breakpoint
CREATE TABLE "nudges" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"persona_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_persona_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" text PRIMARY KEY NOT NULL,
	"email_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_memory" (
	"persona_id" text PRIMARY KEY NOT NULL,
	"canon" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"career_summary" text,
	"greatest_hits" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"owner_id" text,
	"type" "persona_type" NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"origin" text NOT NULL,
	"avatar" text,
	"is_house" boolean DEFAULT false NOT NULL,
	"frequency" "posting_frequency" DEFAULT 'normal' NOT NULL,
	"activity_multiplier" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"persona_id" text NOT NULL,
	"format" "post_format" NOT NULL,
	"body" text NOT NULL,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"event_id" text,
	"callback_post_id" text,
	"grudge_target_id" text,
	"judge_score" jsonb,
	"engagement_score" double precision DEFAULT 0 NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"post_id" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"kind" "reaction_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_post_id_actor_type_actor_id_pk" PRIMARY KEY("post_id","actor_type","actor_id")
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"affinity" real NOT NULL,
	"stage" "relationship_stage" DEFAULT 'neutral' NOT NULL,
	"stage_since" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text[] DEFAULT '{}' NOT NULL,
	"last_event_at" timestamp with time zone,
	CONSTRAINT "relationships_a_id_b_id_pk" PRIMARY KEY("a_id","b_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spend_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"call_type" "call_type" NOT NULL,
	"model" text NOT NULL,
	"transport" "transport" NOT NULL,
	"input_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"est_cost_usd" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_events" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "world_events_date_unique" UNIQUE("date")
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_events" ADD CONSTRAINT "career_events_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_from_id_personas_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_to_id_personas_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_from_id_personas_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_to_id_personas_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_target_persona_id_personas_id_fk" FOREIGN KEY ("target_persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memory" ADD CONSTRAINT "persona_memory_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_event_id_world_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."world_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_grudge_target_id_personas_id_fk" FOREIGN KEY ("grudge_target_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_a_id_personas_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_b_id_personas_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_batch_idx" ON "actions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "career_events_persona_idx" ON "career_events" USING btree ("persona_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_persona_idx" ON "comments" USING btree ("persona_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "nudges_persona_idx" ON "nudges" USING btree ("persona_id","created_at");--> statement-breakpoint
CREATE INDEX "personas_owner_idx" ON "personas" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "posts_persona_created_idx" ON "posts" USING btree ("persona_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "relationships_b_idx" ON "relationships" USING btree ("b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_once_idx" ON "reports" USING btree ("target_type","target_id","reporter_id");--> statement-breakpoint
CREATE INDEX "reports_open_idx" ON "reports" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "spend_ledger_created_idx" ON "spend_ledger" USING btree ("created_at");