// Local development PostgreSQL. Data persists in .dev-pg. Pass --check to set up and exit.
import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 54320;
const databaseDir = ".dev-pg";

const running = await new Promise((resolve) => {
  const socket = net.connect(PORT, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});
if (running) {
  console.log(`PostgreSQL is already running on port ${PORT}. Nothing to do.`);
  process.exit(0);
}

const fresh = !fs.existsSync(`${databaseDir}/PG_VERSION`);
const pg = new EmbeddedPostgres({
  databaseDir, user: "postgres", password: "dev-only", port: PORT, persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("language_manager");

const env = { ...process.env, DATABASE_URL: `postgresql://postgres:dev-only@127.0.0.1:${PORT}/language_manager` };
execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
execSync("npm run db:seed", { env, stdio: "inherit" });

if (process.argv.includes("--check")) {
  await pg.stop();
  process.exit(0);
}
console.log(`PostgreSQL ready on port ${PORT}. Press Ctrl+C to stop.`);
const stop = () => pg.stop().finally(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
