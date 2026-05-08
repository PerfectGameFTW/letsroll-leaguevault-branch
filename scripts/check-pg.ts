import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const locs = await db.execute(sql`
SELECT id, name, organization_id, payment_provider,
       (square_credentials::jsonb ? 'accessToken') as has_token,
       (square_credentials::jsonb ->> 'environment') as env,
       substring(square_credentials::jsonb ->> 'accessToken' from 1 for 4) as token_prefix,
       length(square_credentials::jsonb ->> 'accessToken') as token_len
FROM locations WHERE organization_id = 3;`);
console.log('Perfect Game locations:'); console.table(locs.rows);
const leagues = await db.execute(sql`
SELECT id, name, location_id, active FROM leagues WHERE organization_id = 3 ORDER BY id DESC LIMIT 25;`);
console.log('Perfect Game leagues:'); console.table(leagues.rows);
const bad = await db.execute(sql`
SELECT id, name, location_id FROM leagues
WHERE organization_id = 3 AND (location_id IS NULL OR location_id NOT IN (SELECT id FROM locations WHERE organization_id = 3));`);
console.log('Perfect Game leagues with bad/missing locationId:'); console.table(bad.rows);
process.exit(0);
