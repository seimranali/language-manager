// Packs the built app for this OS and CPU. Native modules make each bundle platform-specific.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const name = `language-manager-${process.argv[2] ?? `v${version}`}-${process.platform}-${process.arch}`;
const out = path.join("release", name);

fs.rmSync("release", { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(".next/standalone", out, { recursive: true, filter: (source) => !/[\\/]\.env/.test(source) });
fs.cpSync(".next/static", path.join(out, ".next/static"), { recursive: true });
for (const item of ["dist", "prisma", "package.json", "package-lock.json", ".env.example", "INSTALL.md"]) {
  fs.cpSync(item, path.join(out, item), { recursive: true });
}

// The standalone trace omits what the worker needs, so install the full production tree.
execSync("npm ci --omit=dev --ignore-scripts=false", { cwd: out, stdio: "inherit" });
execSync("npx --yes prisma@6.19.3 generate", { cwd: out, stdio: "inherit" });

const archive = process.platform === "win32" ? `${name}.zip` : `${name}.tar.gz`;
execSync(process.platform === "win32" ? `tar -a -cf ${archive} ${name}` : `tar -czf ${archive} ${name}`, { cwd: "release", stdio: "inherit" });
console.log(path.join("release", archive));
