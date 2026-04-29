/**
 * In-memory outbox for SendGrid messages whose recipients were on
 * the configured `BLOCK_EMAIL_DOMAINS` list (task #593).
 *
 * The dispatcher in `server/services/email.ts` pushes the fully
 * rendered message here instead of handing it to SendGrid, so tests
 * can:
 *   - Assert the email pipeline ran end-to-end (template lookup,
 *     variable substitution, HTML sanitization, From/To assembly).
 *   - Inspect the rendered subject/body without per-test
 *     `vi.mock('@sendgrid/mail')` boilerplate.
 *
 * The buffer is bounded so a long test run can't grow it without
 * limit. Capacity is intentionally small — tests should call
 * `clearCapturedEmails()` at the start of each scenario rather than
 * relying on the buffer to hold everything.
 */

import type { MailDataRequired } from '@sendgrid/mail';

const MAX_CAPTURED = 200;

export interface CapturedEmail {
  /**
   * The message object that would have gone to `sgMail.send`. This
   * is the post-render snapshot — `to`/`cc`/`bcc` reflect the
   * recipients on the message at dispatch time (which may include
   * blocked addresses, since the whole point of capturing is to
   * preserve what *would* have been sent).
   */
  msg: MailDataRequired;
  /**
   * Recipient domains that triggered the block, lowercased and
   * de-duplicated. Useful for assertions like "this send was
   * skipped because vitest.local was in the recipient list".
   */
  blockedDomains: string[];
  /** Wall-clock time the dispatcher decided to block. */
  capturedAt: Date;
}

const ring: CapturedEmail[] = [];

export function captureEmail(entry: CapturedEmail): void {
  ring.push(entry);
  if (ring.length > MAX_CAPTURED) {
    ring.splice(0, ring.length - MAX_CAPTURED);
  }
}

export function getCapturedEmails(): CapturedEmail[] {
  return ring.slice();
}

export function clearCapturedEmails(): void {
  ring.length = 0;
}
