import { defineConfig } from "vitest/config";
import path from "node:path";
// Data-isolation tests against the hosted dev Supabase project. Run only through `npm run test:rls`, which loads .env.local.
// Files run one at a time: they share one dev database and each cleans up after itself.
export default defineConfig({
  test: {
    include: ["tests/rls/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000, // beforeAll/afterAll create and delete users over the network; testTimeout does not cover hooks
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
