import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/", "dist/", "node_modules/", "tests/load/", "scripts/dev-db.mjs", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/app/api/**/*.ts"],
    rules: {
      // Layering: route handlers reach data and providers only through services.
      "no-restricted-imports": ["error", { patterns: ["@/repositories/*", "@/providers/*", "@/infrastructure/database/*"] }],
    },
  },
  {
    files: ["src/modules/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: ["next/*", "@prisma/client"] }] },
  },
);
