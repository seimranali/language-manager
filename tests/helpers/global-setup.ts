import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 54331;
const URL = `postgresql://postgres:test@127.0.0.1:${PORT}/lm_test`;

/** Boots a real PostgreSQL unless TEST_DATABASE_URL points at one (as in CI). */
export default async function setup() {
  const given = process.env.TEST_DATABASE_URL;
  let stop = async () => {};
  if (!given) {
    const dir = path.resolve(".test-pg");
    fs.rmSync(dir, { recursive: true, force: true });
    const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port: PORT, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("lm_test");
    stop = () => pg.stop();
  }
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: given ?? URL } });
  return stop;
}
