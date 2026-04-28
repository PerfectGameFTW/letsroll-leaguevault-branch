import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("rate_limit_buckets_reset_at_idx").on(table.resetAt),
  ],
);
