import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@shared/schema';

// Configure WebSocket for Neon database
neonConfig.webSocketConstructor = ws;

// Validate database URL is present
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required but not set');
}

// Create connection pool with proper error handling
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Configure Drizzle with our schema
export const db = drizzle(pool, { 
  schema,
  logger: {
    logQuery: (query, params) => {
      console.log('[Database] Query type:', query.split(' ')[0]);
      console.log('[Database] Full query:', query);
      console.log('[Database] Parameters:', params);
    }
  }
});

// Add error handling for the pool
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
  process.exit(-1);
});