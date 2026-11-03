import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Marver design fixture renders in Marver's Vite, not this app.
    "demo/**",
    // Repositories cloned for PMA to read in dev (possibly private code): never this app's to lint.
    ".local-repos/**",
    // Other Claude Code sessions' worktrees: their own checkouts of this repository, linted there.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
