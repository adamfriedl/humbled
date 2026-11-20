CREATE TABLE "ip_salts" (
	"day" text PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_events" (
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_events_key_at_idx" ON "rate_events" USING btree ("key","at");--> statement-breakpoint
CREATE INDEX "rate_events_at_idx" ON "rate_events" USING btree ("at");