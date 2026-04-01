import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { emailTemplates } from "@shared/schema/email-templates";
import type { EmailTemplate, UpdateEmailTemplate } from "@shared/schema";

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  return db.select().from(emailTemplates);
}

export async function getEmailTemplate(id: number): Promise<EmailTemplate | undefined> {
  const [result] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
  return result;
}

export async function getEmailTemplateBySlug(slug: string): Promise<EmailTemplate | undefined> {
  const [result] = await db.select().from(emailTemplates).where(eq(emailTemplates.slug, slug));
  return result;
}

export async function updateEmailTemplate(id: number, data: UpdateEmailTemplate): Promise<EmailTemplate> {
  const [result] = await db.update(emailTemplates).set(data).where(eq(emailTemplates.id, id)).returning();
  if (!result) {
    throw new Error(`Email template with ID ${id} not found`);
  }
  return result;
}
