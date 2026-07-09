import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase;
};

function createDb(): NodePgDatabase {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool =
    globalForDb.__arenaNextJsPostgresqlPool ??
    new Pool({
      connectionString: databaseUrl,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = pool;
  }

  return drizzle(pool);
}

// Lazy proxy so we don't touch DATABASE_URL at import/build time.
// The real connection is only established the first time `db` is used at runtime.
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, prop, receiver) {
    if (!globalForDb.__arenaNextJsPostgresqlDb) {
      globalForDb.__arenaNextJsPostgresqlDb = createDb();
    }
    const value = Reflect.get(globalForDb.__arenaNextJsPostgresqlDb, prop, receiver);
    return typeof value === "function"
      ? value.bind(globalForDb.__arenaNextJsPostgresqlDb)
      : value;
  },
});

export function getPool(): Pool {
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    // Trigger lazy init
    void (db as unknown as { $client: unknown }).$client;
  }
  return globalForDb.__arenaNextJsPostgresqlPool!;
}
