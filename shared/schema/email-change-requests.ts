import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { emailSchema } from "./constants";
import { users } from "./users";

export const emailChangeRequests = pgTable("email_change_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  newEmail: text("new_email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { mode: "string" }),
}, (table) => ({
  userIdx: index("email_change_requests_user_idx").on(table.userId),
}));

export const insertEmailChangeRequestSchema = createInsertSchema(emailChangeRequests)
  .extend({
    newEmail: emailSchema,
    tokenHash: z.string().min(1),
    expiresAt: z.union([z.string(), z.date()]).transform((v) =>
      typeof v === "string" ? v : v.toISOString(),
    ),
  })
  .omit({ id: true, createdAt: true, consumedAt: true });

export type EmailChangeRequest = typeof emailChangeRequests.$inferSelect;
export type InsertEmailChangeRequest = z.infer<typeof insertEmailChangeRequestSchema>;
