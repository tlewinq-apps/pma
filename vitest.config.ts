import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // tests/rls needs the dev database; it runs only through `npm run test:rls` so `npm test` stays database-free.
    exclude: [...configDefaults.exclude, "tests/rls/**"],
    environment: "node",
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
