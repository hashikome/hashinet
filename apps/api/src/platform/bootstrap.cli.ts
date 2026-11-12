import { parseArgs } from "node:util";
import { loadConfig } from "../config/config.js";
import { createPrismaClient } from "../database/client.js";
import { bootstrapPlatform } from "./bootstrap.js";

// bun run platform:bootstrap --email admin@example.com --name "Admin"
// Run once on a fresh database, in the API image in production; running it again changes nothing.
const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});
if (!values.email || !values.name) {
  process.stderr.write("Usage: bun run platform:bootstrap --email <email> --name <name>\n");
  process.exit(2);
}
const db = createPrismaClient(loadConfig().databaseUrl);
try {
  const result = await bootstrapPlatform(db, { email: values.email, name: values.name });
  process.stdout.write(
    `Platform admin: ${result.admin}; default packages: ${result.defaultPackages}.\n`,
  );
} finally {
  await db.$disconnect();
}
