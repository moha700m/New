import { PrismaClient } from "@prisma/client";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM helper shared with the build script
import { withSchema } from "../../scripts/db-url.mjs";

/** Schema JB AI's tables live in (DB_SCHEMA env, default from the connection string, else "public"). */
export const DB_SCHEMA: string = process.env.DB_SCHEMA || (process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).searchParams.get("schema") : null) || "public";

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma =
  g.__prisma ??
  new PrismaClient({
    log: ["error"],
    ...(process.env.DATABASE_URL ? { datasourceUrl: withSchema(process.env.DATABASE_URL) as string } : {}),
  });
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;
