export function maskEmail(email: string): string {
  if (typeof email !== 'string') return '***';
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const first = local.charAt(0);
  if (!first) return `***@${domain}`;
  return `${first}***@${domain}`;
}
