import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentRuntimeState,
  agents,
  agentTaskSessions,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres quota exhaustion tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("Gemini quota exhaustion retry logic", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-quota-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentTaskSessions);
    await db.delete(agentRuntimeState);
    await db.delete(companySkills);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture(input?: {
    quotaRetryCount?: number;
    includeIssue?: boolean;
    scheduledAt?: Date | null;
    runStatus?: "running" | "queued" | "failed";
    agentStatus?: string;
  }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();
    const issueId = randomUUID();
    const now = new Date("2026-03-30T00:00:00.000Z");
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "GeminiCoder",
      role: "engineer",
      status: input?.agentStatus ?? "idle",
      adapterType: "gemini_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: input?.includeIssue === false ? {} : { issueId },
      status: "claimed",
      runId,
      claimedAt: now,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: input?.runStatus ?? "failed",
      wakeupRequestId,
      contextSnapshot: {
        ...(input?.includeIssue !== false ? { issueId } : {}),
        ...(input?.quotaRetryCount !== undefined ? { quotaRetryCount: input.quotaRetryCount } : {}),
      },
      scheduledAt: input?.scheduledAt !== undefined ? input.scheduledAt : null,
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
    });

    if (input?.includeIssue !== false) {
      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Test issue for quota retry",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        checkoutRunId: runId,
        executionRunId: runId,
        issueNumber: 1,
        identifier: `${issuePrefix}-1`,
      });
    }

    return { companyId, agentId, runId, wakeupRequestId, issueId, now };
  }

  // ─── enqueueQuotaExhaustedRetry ─────────────────────────────────────────────

  describe("enqueueQuotaExhaustedRetry", () => {
    it("creates a delayed retry run with scheduledAt roughly 60s out (attempt 0)", async () => {
      const { agentId, runId, issueId } = await seedFixture();
      const heartbeat = heartbeatService(db);

      const run = await heartbeat.getRun(runId);
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r) => r[0]);
      const before = new Date();
      const retryRun = await heartbeat.enqueueQuotaExhaustedRetry(run!, agent!, new Date());
      void issueId;

      expect(retryRun).not.toBeNull();
      expect(retryRun?.status).toBe("queued");
      expect(retryRun?.retryOfRunId).toBe(runId);
      expect(retryRun?.scheduledAt).not.toBeNull();

      // base 60s ±20% jitter → 48–72s
      const delayMs = retryRun!.scheduledAt!.getTime() - before.getTime();
      expect(delayMs).toBeGreaterThanOrEqual(48_000);
      expect(delayMs).toBeLessThanOrEqual(80_000);
    });

    it("re-assigns the issue executionRunId to the retry run atomically", async () => {
      const { runId, issueId } = await seedFixture();
      const heartbeat = heartbeatService(db);

      const run = await heartbeat.getRun(runId);
      const agent = await db.select().from(agents).where(eq(agents.id, run!.agentId)).then((r) => r[0]);
      const retryRun = await heartbeat.enqueueQuotaExhaustedRetry(run!, agent!, new Date());

      const issue = await db.select().from(issues).where(eq(issues.id, issueId)).then((r) => r[0] ?? null);
      expect(issue?.executionRunId).toBe(retryRun?.id);
    });

    it("doubles the backoff on the second attempt (quotaRetryCount=1 → ~120s)", async () => {
      const { runId, agentId } = await seedFixture({ quotaRetryCount: 1 });
      const heartbeat = heartbeatService(db);

      const run = await heartbeat.getRun(runId);
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r) => r[0]);
      const before = new Date();
      const retryRun = await heartbeat.enqueueQuotaExhaustedRetry(run!, agent!, new Date());

      // 60 * 2^1 = 120s ±20% → 96–144s
      const delayMs = retryRun!.scheduledAt!.getTime() - before.getTime();
      expect(delayMs).toBeGreaterThanOrEqual(96_000);
      expect(delayMs).toBeLessThanOrEqual(160_000);
    });

    it("caps the backoff at 600s (quotaRetryCount=4 → 60*2^4=960 → capped to 600s)", async () => {
      const { runId, agentId } = await seedFixture({ quotaRetryCount: 4 });
      const heartbeat = heartbeatService(db);

      const run = await heartbeat.getRun(runId);
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r) => r[0]);
      const before = new Date();
      const retryRun = await heartbeat.enqueueQuotaExhaustedRetry(run!, agent!, new Date());

      // capped 600s ±20% → 480–720s
      const delayMs = retryRun!.scheduledAt!.getTime() - before.getTime();
      expect(delayMs).toBeGreaterThanOrEqual(480_000);
      expect(delayMs).toBeLessThanOrEqual(720_000);
    });

    it("returns null and creates no retry when at the cap (quotaRetryCount=5)", async () => {
      const { agentId, runId } = await seedFixture({ quotaRetryCount: 5 });
      const heartbeat = heartbeatService(db);

      const run = await heartbeat.getRun(runId);
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r) => r[0]);
      const retryRun = await heartbeat.enqueueQuotaExhaustedRetry(run!, agent!, new Date());

      expect(retryRun).toBeNull();

      const allRuns = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
      expect(allRuns).toHaveLength(1);
    });
  });

  // ─── scheduledAt filtering (via startNextQueuedRunForAgent) ─────────────────

  describe("scheduledAt filtering in startNextQueuedRunForAgent", () => {
    it("does not claim a queued run whose scheduledAt is in the future", async () => {
      const { agentId } = await seedFixture({
        runStatus: "queued",
        agentStatus: "idle",
        includeIssue: false,
        scheduledAt: new Date(Date.now() + 60_000), // 60s from now
      });
      const heartbeat = heartbeatService(db);

      const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
      expect(claimed).toHaveLength(0);
    });

    it("claims a queued run whose scheduledAt is in the past", async () => {
      const { agentId, runId } = await seedFixture({
        runStatus: "queued",
        agentStatus: "idle",
        includeIssue: false,
        scheduledAt: new Date(Date.now() - 5_000), // 5s ago
      });
      const heartbeat = heartbeatService(db);

      const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe(runId);

      // Wait for async execution to settle before afterEach cleanup
      let run = await heartbeat.getRun(runId);
      for (let i = 0; i < 30 && run?.status === "running"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        run = await heartbeat.getRun(runId);
      }
    }, 10_000);

    it("claims a queued run with null scheduledAt immediately", async () => {
      const { agentId, runId } = await seedFixture({
        runStatus: "queued",
        agentStatus: "idle",
        includeIssue: false,
        scheduledAt: null,
      });
      const heartbeat = heartbeatService(db);

      const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe(runId);

      // Wait for async execution to settle before afterEach cleanup
      let run = await heartbeat.getRun(runId);
      for (let i = 0; i < 30 && run?.status === "running"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        run = await heartbeat.getRun(runId);
      }
    }, 10_000);
  });
});
