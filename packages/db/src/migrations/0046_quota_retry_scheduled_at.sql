ALTER TABLE "heartbeat_runs" ADD COLUMN "scheduled_at" timestamp with time zone;
CREATE INDEX "heartbeat_runs_scheduled_at_idx" ON "heartbeat_runs" ("scheduled_at");
