import { z } from 'zod';
import { cleanup as closeDbPool } from '../server/db';
import { getPaymentProvider } from '../server/services/payment-provider-factory';
import { SquarePaymentProvider } from '../server/services/square-provider';
import { createLogger } from '../server/logger';

const log = createLogger('ListSquareAttrDefs');

// Parse only the surface we care about (key/name/createdAt) — Zod's
// inferred type makes the access type-safe without `as unknown as`.
const ListResponseSchema = z.object({
  data: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        createdAt: z.string().optional(),
        visibility: z.string().optional(),
      }).passthrough(),
    )
    .optional(),
});

async function main(): Promise<number> {
  const provider = await getPaymentProvider(1);
  if (!(provider instanceof SquarePaymentProvider)) {
    log.error('Not a Square provider');
    return 4;
  }
  const client = await provider.getSquareClientForDiagnostics();
  if (!client) {
    log.error('No Square client');
    return 5;
  }
  const raw = await client.customers.customAttributeDefinitions.list({});
  const parsed = ListResponseSchema.parse(raw);
  log.info('Customer custom-attribute definitions on seller', {
    count: parsed.data?.length ?? 0,
    defs: parsed.data ?? [],
  });
  return 0;
}

main()
  .then(async (c) => {
    await closeDbPool();
    process.exit(c);
  })
  .catch(async (e) => {
    log.error('list failed', {
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    });
    await closeDbPool().catch(() => undefined);
    process.exit(1);
  });
