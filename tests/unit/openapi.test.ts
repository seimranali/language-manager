import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "@/shared/http/openapi";

const ROOT = path.resolve("src/app/api/v1");

function routes(dir: string): { path: string; methods: string[] }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routes(full);
    if (entry.name !== "route.ts") return [];
    const url = path.relative(ROOT, dir).split(path.sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
    const methods = [...fs.readFileSync(full, "utf8").matchAll(/export (?:const|function) (GET|POST|PATCH|DELETE)\b/g)].map((m) => m[1]!.toLowerCase());
    return [{ path: `/${url}`, methods }];
  });
}

describe("OpenAPI document", () => {
  it("documents every implemented route and method", () => {
    const paths = openApiDocument().paths;
    for (const route of routes(ROOT)) {
      for (const method of route.methods) expect(paths[route.path]?.[method], `${method} ${route.path}`).toBeDefined();
    }
  });
});
