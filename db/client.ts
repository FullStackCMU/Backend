import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@db/schema.js";
import postgres from "postgres";
import { connectionString } from "@db/utils.js";

export const dbConn = postgres(connectionString);

// ห้าม log params — มีความเห็นในแบบประเมิน
const logger = { logQuery: (query: string) => console.log(`Query: ${query}`) };

export const dbClient = drizzle(dbConn, { schema: schema, logger });
