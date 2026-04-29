/**
 * Stub Square SDK client for `server/scripts/create-square-customers.ts`.
 *
 * Loaded via the `SQUARE_CLIENT_IMPL_PATH` test seam (task #465) so the
 * cross-org integration test can drive the script through the bowler
 * SELECT/UPDATE branch without making real Square API calls.
 *
 * Returns a deterministic-looking customer id derived from `referenceId`
 * (which the script sets to `bowler.id.toString()`), with a per-process
 * counter appended so back-to-back invocations within a single suite
 * never collide on a previously-stored id.
 */
let counter = 0;

export function createSquareClient() {
  return {
    // v40+ flat-client SDK: the resource lives under `customers` (not
    // `customersApi`) and `customers.create` returns the response body
    // directly (no `.result` wrapper). Mirrors the real SquareClient
    // shape so the script under test consumes the same fields it will
    // see in production.
    customers: {
      async create(input: {
        idempotencyKey: string;
        givenName: string;
        familyName: string;
        emailAddress: string;
        referenceId: string;
      }) {
        counter += 1;
        return {
          customer: {
            id: `vitest-fake-cust-${input.referenceId}-${counter}`,
          },
        };
      },
    },
  };
}
