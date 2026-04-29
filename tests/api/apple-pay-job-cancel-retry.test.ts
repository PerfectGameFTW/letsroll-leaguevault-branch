/**
 * Route tests for the Apple Pay job admin endpoints introduced in #259
 * plus the DELETE /apple-pay/jobs/:id endpoint added later for orphan
 * cleanup (motivated by job #5104 — see admin Apple Pay jobs page).
 *
 * Endpoints under test:
 *   - POST   /api/payments-provider/apple-pay/jobs/:id/cancel
 *   - DELETE /api/payments-provider/apple-pay/jobs/:id
 *   - POST   /api/payments-provider/apple-pay/jobs/:id/retry
 *   - POST   /api/payments-provider/apple-pay/jobs/:id/items/:itemId/retry
 *
 * Pins:
 *   - 403 for non-admin callers (org_admin, no session)
 *   - 404 for unknown jobs
 *   - 409 NOT_CANCELABLE / NOT_RETRYABLE / NOT_DELETABLE for ineligible-status guards
 *   - 200 happy paths against real DB-backed jobs
 *
 * Storage-level transitions are covered by tests/unit/apple-pay-jobs.test.ts;
 * here we only assert the HTTP contract the admin UI relies on.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../server/db";
import {
  applePayJobs,
  applePayJobItems,
  type ApplePayJobStatus,
} from "@shared/schema";
import { APPLE_PAY_TEST_FIXTURE_DOMAIN_SUFFIX } from "../../server/storage/apple-pay-jobs";
import {
  apiDelete,
  apiPost,
  login,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from "../helpers";

/**
 * Belt-and-suspenders sweep (#592) — see
 * `tests/unit/apple-pay-jobs.test.ts` for the rationale. Removes any
 * job that has at least one item whose domain ends in the sentinel
 * `.api.vitest-fixture.invalid` TLD. Tolerant of zero rows.
 */
// Suite-scoped purge pattern: this file ONLY plants `.api.<suffix>`
// rows, so the sweep MUST NOT match `.unit.<suffix>` rows planted by
// the sibling unit test (#592 architect review). Cross-suite deletion
// would race-delete in-flight rows from the other vitest worker.
const SENTINEL_DOMAIN_PATTERN = `%.api${APPLE_PAY_TEST_FIXTURE_DOMAIN_SUFFIX}`;
async function purgeSentinelApplePayJobs(): Promise<void> {
  await db.delete(applePayJobs).where(
    sql`EXISTS (
      SELECT 1 FROM ${applePayJobItems}
      WHERE ${applePayJobItems.jobId} = ${applePayJobs.id}
        AND ${applePayJobItems.domain} LIKE ${SENTINEL_DOMAIN_PATTERN}
    )`,
  );
}

const createdJobIds: number[] = [];

async function makeJob(opts: {
  status: ApplePayJobStatus;
  items?: Array<{ status: "pending" | "processing" | "succeeded" | "failed" | "skipped"; message?: string | null }>;
}): Promise<{ jobId: number; itemIds: number[] }> {
  const [job] = await db
    .insert(applePayJobs)
    .values({
      status: opts.status,
      // Terminal jobs in production carry a completedAt; mirror that so
      // route tests start from a realistic shape.
      completedAt:
        opts.status === "pending" || opts.status === "running"
          ? null
          : new Date().toISOString(),
    })
    .returning();
  createdJobIds.push(job.id);

  const itemIds: number[] = [];
  if (opts.items?.length) {
    const inserted = await db
      .insert(applePayJobItems)
      .values(
        opts.items.map((it, i) => ({
          jobId: job.id,
          organizationId: null,
          locationId: null,
          domain: `route-test-${job.id}-${i}.api.vitest-fixture.invalid`,
          status: it.status,
          message: it.message ?? null,
          processedAt: it.status === "pending" ? null : new Date().toISOString(),
        })),
      )
      .returning({ id: applePayJobItems.id });
    itemIds.push(...inserted.map((r) => r.id));
  }
  return { jobId: job.id, itemIds };
}

// Per-test cleanup (not afterAll) so we don't leave `pending` rows lying
// around for the duration of the suite. Other Apple Pay tests run against
// the same DB and their `claimNextApplePayJob`-based assertions assume no
// other pending job exists.
afterEach(async () => {
  if (createdJobIds.length > 0) {
    await db.delete(applePayJobs).where(inArray(applePayJobs.id, createdJobIds));
    createdJobIds.length = 0;
  }
});

// Suite-level safety net (#592) — sweep any sentinel rows leaked by a
// crashed prior worker so the Apple Pay Jobs admin page stays clean.
beforeAll(purgeSentinelApplePayJobs);
afterAll(purgeSentinelApplePayJobs);

const cancelPath = (id: number | string) =>
  `/api/payments-provider/apple-pay/jobs/${id}/cancel`;
const retryJobPath = (id: number | string) =>
  `/api/payments-provider/apple-pay/jobs/${id}/retry`;
const retryItemPath = (jobId: number | string, itemId: number | string) =>
  `/api/payments-provider/apple-pay/jobs/${jobId}/items/${itemId}/retry`;

describe("POST /apple-pay/jobs/:id/cancel", () => {
  it("403 FORBIDDEN for an unauthenticated caller", async () => {
    const res = await apiPost(cancelPath(1), {});
    // CSRF middleware may reject before the role check; either way an
    // unauthenticated caller must NOT get a 200.
    expect([401, 403]).toContain(res.status);
  });

  it("403 FORBIDDEN for an org_admin (non-system-admin)", async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const { jobId } = await makeJob({ status: "pending" });
    const res = await apiPost(cancelPath(jobId), {}, session);
    expect(res.status).toBe(403);
    expect(res.data.error?.code).toBe("FORBIDDEN");
  });

  it("404 NOT_FOUND for an unknown job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const res = await apiPost(cancelPath(2_147_483_000), {}, session);
    expect(res.status).toBe(404);
    expect(res.data.error?.code).toBe("NOT_FOUND");
  });

  it("409 NOT_CANCELABLE for a terminal job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId } = await makeJob({ status: "succeeded" });
    const res = await apiPost(cancelPath(jobId), {}, session);
    expect(res.status).toBe(409);
    expect(res.data.error?.code).toBe("NOT_CANCELABLE");
    expect(res.data.error?.message).toMatch(/succeeded/i);
  });

  it("200 cancels a pending job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId } = await makeJob({ status: "pending" });
    const res = await apiPost<{ job: { status: string } }>(
      cancelPath(jobId),
      {},
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data?.job.status).toBe("canceled");

    const [reloaded] = await db
      .select({ status: applePayJobs.status })
      .from(applePayJobs)
      .where(eq(applePayJobs.id, jobId));
    expect(reloaded.status).toBe("canceled");
  });

  it("200 cancels a running job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId } = await makeJob({ status: "running" });
    const res = await apiPost<{ job: { status: string } }>(
      cancelPath(jobId),
      {},
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.data?.job.status).toBe("canceled");
  });
});

describe("DELETE /apple-pay/jobs/:id", () => {
  const deletePath = (id: number | string) =>
    `/api/payments-provider/apple-pay/jobs/${id}`;

  it("403 FORBIDDEN for an unauthenticated caller", async () => {
    const res = await apiDelete(deletePath(1));
    // CSRF middleware may reject before the role check; either way an
    // unauthenticated caller must NOT get a 200.
    expect([401, 403]).toContain(res.status);
  });

  it("403 FORBIDDEN for an org_admin (non-system-admin)", async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const { jobId } = await makeJob({ status: "succeeded" });
    const res = await apiDelete(deletePath(jobId), session);
    expect(res.status).toBe(403);
    expect(res.data.error?.code).toBe("FORBIDDEN");
  });

  it("404 NOT_FOUND for an unknown job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const res = await apiDelete(deletePath(2_147_483_003), session);
    expect(res.status).toBe(404);
    expect(res.data.error?.code).toBe("NOT_FOUND");
  });

  it("409 NOT_DELETABLE for an active (pending) job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId } = await makeJob({ status: "pending" });
    const res = await apiDelete(deletePath(jobId), session);
    expect(res.status).toBe(409);
    expect(res.data.error?.code).toBe("NOT_DELETABLE");
    expect(res.data.error?.message).toMatch(/pending/i);
  });

  it("409 NOT_DELETABLE for a running job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId } = await makeJob({ status: "running" });
    const res = await apiDelete(deletePath(jobId), session);
    expect(res.status).toBe(409);
    expect(res.data.error?.code).toBe("NOT_DELETABLE");
  });

  it("200 deletes a terminal job and cascades to its items", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId, itemIds } = await makeJob({
      status: "failed",
      items: [
        { status: "failed", message: "boom" },
        { status: "skipped", message: "no loc" },
      ],
    });
    const res = await apiDelete<{ deleted: boolean; jobId: number }>(
      deletePath(jobId),
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data?.deleted).toBe(true);
    expect(res.data.data?.jobId).toBe(jobId);

    // Job row gone.
    const remaining = await db
      .select({ id: applePayJobs.id })
      .from(applePayJobs)
      .where(eq(applePayJobs.id, jobId));
    expect(remaining).toHaveLength(0);

    // Items gone via FK ON DELETE CASCADE.
    const orphans = await db
      .select({ id: applePayJobItems.id })
      .from(applePayJobItems)
      .where(inArray(applePayJobItems.id, itemIds));
    expect(orphans).toHaveLength(0);

    // Drop from afterEach cleanup — nothing left to delete.
    const idx = createdJobIds.indexOf(jobId);
    if (idx >= 0) createdJobIds.splice(idx, 1);
  });
});

describe("POST /apple-pay/jobs/:id/retry", () => {
  it("403 FORBIDDEN for org_admin", async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const { jobId } = await makeJob({ status: "failed" });
    const res = await apiPost(retryJobPath(jobId), {}, session);
    expect(res.status).toBe(403);
    expect(res.data.error?.code).toBe("FORBIDDEN");
  });

  it("404 for an unknown job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const res = await apiPost(retryJobPath(2_147_483_001), {}, session);
    expect(res.status).toBe(404);
    expect(res.data.error?.code).toBe("NOT_FOUND");
  });

  it("409 NOT_RETRYABLE for a non-terminal (running) job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId } = await makeJob({
      status: "running",
      items: [{ status: "failed", message: "boom" }],
    });
    const res = await apiPost(retryJobPath(jobId), {}, session);
    expect(res.status).toBe(409);
    expect(res.data.error?.code).toBe("NOT_RETRYABLE");
  });

  it("409 NOT_RETRYABLE for a terminal job with no failed items", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId } = await makeJob({
      status: "partial",
      items: [
        { status: "succeeded" },
        { status: "skipped", message: "no loc" },
      ],
    });
    const res = await apiPost(retryJobPath(jobId), {}, session);
    expect(res.status).toBe(409);
    expect(res.data.error?.code).toBe("NOT_RETRYABLE");
  });

  it("200 resets failed items and re-opens the job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId, itemIds } = await makeJob({
      status: "failed",
      items: [
        { status: "failed", message: "x" },
        { status: "failed", message: "y" },
        { status: "succeeded" },
      ],
    });
    const res = await apiPost<{ job: { status: string }; resetCount: number }>(
      retryJobPath(jobId),
      {},
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.data?.job.status).toBe("pending");
    expect(res.data.data?.resetCount).toBe(2);

    const reloaded = await db
      .select({ id: applePayJobItems.id, status: applePayJobItems.status })
      .from(applePayJobItems)
      .where(inArray(applePayJobItems.id, itemIds));
    const succeededItem = reloaded.find((r) => r.id === itemIds[2])!;
    expect(succeededItem.status).toBe("succeeded");
    const failedReset = reloaded.filter((r) => r.id !== itemIds[2]);
    expect(failedReset.every((r) => r.status === "pending")).toBe(true);
  });
});

describe("POST /apple-pay/jobs/:id/items/:itemId/retry", () => {
  it("403 FORBIDDEN for org_admin", async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const { jobId, itemIds } = await makeJob({
      status: "failed",
      items: [{ status: "failed", message: "x" }],
    });
    const res = await apiPost(retryItemPath(jobId, itemIds[0]), {}, session);
    expect(res.status).toBe(403);
    expect(res.data.error?.code).toBe("FORBIDDEN");
  });

  it("404 for an unknown job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const res = await apiPost(retryItemPath(2_147_483_002, 1), {}, session);
    expect(res.status).toBe(404);
    expect(res.data.error?.code).toBe("NOT_FOUND");
  });

  it("409 NOT_RETRYABLE when the parent job is still running", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId, itemIds } = await makeJob({
      status: "running",
      items: [{ status: "failed", message: "transient" }],
    });
    const res = await apiPost(retryItemPath(jobId, itemIds[0]), {}, session);
    expect(res.status).toBe(409);
    expect(res.data.error?.code).toBe("NOT_RETRYABLE");
  });

  it("409 NOT_RETRYABLE when the item is not in failed status", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId, itemIds } = await makeJob({
      status: "partial",
      items: [{ status: "succeeded" }],
    });
    const res = await apiPost(retryItemPath(jobId, itemIds[0]), {}, session);
    expect(res.status).toBe(409);
    expect(res.data.error?.code).toBe("NOT_RETRYABLE");
  });

  it("200 retries a single failed item under a terminal job", async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { jobId, itemIds } = await makeJob({
      status: "failed",
      items: [
        { status: "failed", message: "still bad" },
        { status: "failed", message: "transient" },
      ],
    });
    // Retry only the second failed item — the first must be left as-is.
    const res = await apiPost<{ item: { status: string }; job: { status: string } }>(
      retryItemPath(jobId, itemIds[1]),
      {},
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.data?.item.status).toBe("pending");
    expect(res.data.data?.job.status).toBe("pending");

    const reloaded = await db
      .select({ id: applePayJobItems.id, status: applePayJobItems.status })
      .from(applePayJobItems)
      .where(inArray(applePayJobItems.id, itemIds));
    const first = reloaded.find((r) => r.id === itemIds[0])!;
    const second = reloaded.find((r) => r.id === itemIds[1])!;
    expect(first.status).toBe("failed");
    expect(second.status).toBe("pending");
  });
});
