import { db } from "../db.js";
import { emailTemplates, type InsertEmailTemplate } from "@shared/schema/email-templates";
import { createLogger } from "../logger";

const log = createLogger("SeedEmailTemplates");

const DEFAULT_TEMPLATES: InsertEmailTemplate[] = [
  {
    slug: "bowler_payment_link_invite",
    name: "Bowler Payment Partner Invite",
    description:
      "Sent when a bowler invites another bowler to be a payment partner. Includes one-click Accept and Decline links plus an in-app deep link.",
    subject: "{{inviter_name}} invited you to be a payment partner",
    body:
      "Hi {{invitee_name}},\n\n" +
      "{{inviter_name}} invited you to be a payment partner on {{organization_name}}. " +
      "Payment partners can pay each other's league fees from their own saved cards.\n\n" +
      "Accept the invite:\n{{accept_link}}\n\n" +
      "Decline the invite:\n{{decline_link}}\n\n" +
      "Open in app:\n{{app_link}}\n\n" +
      "These links expire in 14 days.",
    active: true,
  },
];

export async function seedDefaultEmailTemplates(): Promise<void> {
  for (const tpl of DEFAULT_TEMPLATES) {
    const result = await db
      .insert(emailTemplates)
      .values(tpl)
      .onConflictDoNothing({ target: emailTemplates.slug })
      .returning({ id: emailTemplates.id });
    if (result.length > 0) {
      log.info(`Seeded email template '${tpl.slug}'`);
    }
  }
}
