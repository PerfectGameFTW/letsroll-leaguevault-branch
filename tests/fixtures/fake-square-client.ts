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
    customersApi: {
      async createCustomer(input: {
        idempotencyKey: string;
        givenName: string;
        familyName: string;
        emailAddress: string;
        referenceId: string;
      }) {
        counter += 1;
        return {
          result: {
            customer: {
              id: `vitest-fake-cust-${input.referenceId}-${counter}`,
            },
          },
        };
      },
    },
  };
}
