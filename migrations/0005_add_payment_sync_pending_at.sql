CREATE TABLE "alerter_state" (
	"kind" text PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bowlers" ADD COLUMN "payment_sync_pending_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_org_required" CHECK ("users"."role" = 'system_admin' OR "users"."organization_id" IS NOT NULL);