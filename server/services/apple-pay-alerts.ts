import { env, isDev } from "../config";
import { createLogger } from "../logger";
import { storage } from "../storage";
import { sendApplePayRecoveryAlert } from "./email";

const log = createLogger("ApplePayAlerts");

const ALERT_KIND = "apple_pay_recovery";

interface RecoveredItem {
  jobId: number;
  itemId: number;
}

export interface AlerterDeps {
  send: typeof sendApplePayRecoveryAlert;
  getAdminEmails: () => Promise<string[]>;
  isEnabled: () => boolean;
  minIntervalMs: () => number;
  /**
   * Atomically attempt to claim the next alert slot. Persisted in the
   * database so multi-instance deployments and rapid restart loops
   * cannot bypass the rate limit.
   */
  tryClaimSlot: (
    kind: string,
    minIntervalMs: number,
  ) => Promise<{ claimed: boolean; suppressedCount: number }>;
}

const defaultDeps: AlerterDeps = {
  send: sendApplePayRecoveryAlert,
  getAdminEmails: async () => {
    const allUsers = await storage.getUsers();
    return allUsers
      .filter((u) => u.role === "system_admin" && u.email)
      .map((u) => u.email);
  },
  isEnabled: () => {
    if (env.APPLE_PAY_RECOVERY_ALERTS_ENABLED !== undefined) {
      return env.APPLE_PAY_RECOVERY_ALERTS_ENABLED;
    }
    return !isDev;
  },
  minIntervalMs: () => env.APPLE_PAY_RECOVERY_ALERT_MIN_INTERVAL_MS,
  tryClaimSlot: (kind, ms) => storage.tryClaimAlerterSlot(kind, ms),
};

export type NotifyResult =
  | "sent"
  | "rate-limited"
  | "disabled"
  | "no-recipients"
  | "no-items"
  | "failed";

export class ApplePayRecoveryAlerter {
  constructor(private readonly deps: AlerterDeps = defaultDeps) {}

  async notifyRecovered(items: RecoveredItem[]): Promise<NotifyResult> {
    if (items.length === 0) return "no-items";
    if (!this.deps.isEnabled()) {
      log.info("Apple Pay recovery alerts disabled — skipping email", {
        itemCount: items.length,
      });
      return "disabled";
    }

    let claim: { claimed: boolean; suppressedCount: number };
    try {
      claim = await this.deps.tryClaimSlot(ALERT_KIND, this.deps.minIntervalMs());
    } catch (err) {
      log.error("Failed to claim Apple Pay alerter slot", {
        err: err instanceof Error ? err.message : String(err),
      });
      return "failed";
    }

    if (!claim.claimed) {
      log.warn("Apple Pay recovery alert rate-limited", {
        itemCount: items.length,
        suppressedCount: claim.suppressedCount,
        minIntervalMs: this.deps.minIntervalMs(),
      });
      return "rate-limited";
    }

    let toEmails: string[];
    try {
      toEmails = await this.deps.getAdminEmails();
    } catch (err) {
      log.error("Failed to load system-admin emails for Apple Pay alert", {
        err: err instanceof Error ? err.message : String(err),
      });
      return "failed";
    }
    if (toEmails.length === 0) {
      log.warn("No system-admin recipients configured for Apple Pay recovery alert");
      return "no-recipients";
    }

    const affectedJobIds = Array.from(new Set(items.map((i) => i.jobId)));
    const itemIds = items.map((i) => i.itemId);

    const sent = await this.deps.send(toEmails, {
      itemCount: items.length,
      affectedJobIds,
      itemIds,
      suppressedSinceLastAlert: claim.suppressedCount,
    });

    return sent ? "sent" : "failed";
  }
}

export const applePayRecoveryAlerter = new ApplePayRecoveryAlerter();
