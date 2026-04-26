/**
 * Single source of truth for interpreting `REPLIT_DEPLOYMENT`.
 *
 * Replit sets `REPLIT_DEPLOYMENT=1` on Reserved-VM and Autoscale
 * deploys; it is unset on local/dev runs. The env schema accepts
 * `REPLIT_DEPLOYMENT` as a free-form optional string (it can also
 * legitimately be the empty string when the platform exports it
 * blank), so callers must NOT use a bare `!!value` truthiness check
 * — that would treat the empty-string case identically to a real
 * deploy in some readers and identically to "unset" in others.
 *
 * This helper centralises the contract: a value counts as a real
 * deploy iff it is a non-empty string. Empty string and `undefined`
 * both mean "not deployed".
 */
export function isReplitDeploymentValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}
