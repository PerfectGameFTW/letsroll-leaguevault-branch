import { pgTable, text, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  active: boolean("active").notNull().default(true),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true });
export const updateEmailTemplateSchema = z.object({
  subject: z.string(),
  body: z.string(),
  active: z.boolean(),
}).partial();
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type UpdateEmailTemplate = z.infer<typeof updateEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
