import { cleanup as closeDbPool } from '../server/db';
import { storage } from '../server/storage';
import { syncBowlerForUser } from '../server/services/payment-customer-sync';
import { createLogger } from '../server/logger';

const log = createLogger('VerifyBowlerSync');

async function main(): Promise<number> {
  const arg = process.argv.find((a) => a.startsWith('--bowlerId='));
  const bowlerId = arg ? Number(arg.split('=')[1]) : 19643;
  if (!Number.isInteger(bowlerId) || bowlerId <= 0) {
    log.error('Invalid --bowlerId', { bowlerId });
    return 2;
  }
  const user = await storage.getUserByBowlerId(bowlerId);
  if (!user) {
    log.error('No linked user for bowler', { bowlerId });
    return 3;
  }
  log.info('Resolved linked user for bowler', { bowlerId, userId: user.id, email: user.email });
  const res = await syncBowlerForUser(user, {
    nameChanged: false,
    emailChanged: false,
    phoneChanged: false,
  });
  log.info('syncBowlerForUser result', { bowlerId, result: res });
  return res === 'synced' ? 0 : 1;
}

main()
  .then(async (code) => {
    await closeDbPool();
    process.exit(code);
  })
  .catch(async (err) => {
    log.error('Verify run failed', {
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });
    await closeDbPool().catch(() => undefined);
    process.exit(1);
  });
