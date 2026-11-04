import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Every default under the home folder (state dir, jails, OAuth files)
// resolves inside a throwaway HOME, so a test that skips its own
// override can't write into the real ~/.google-mcp. The global setup's
// teardown deletes it.
const testHome = mkdtempSync(join(tmpdir(), "google-mcp-test-home-"));
process.env.GOOGLE_MCP_TEST_HOME = testHome;

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    env: { HOME: testHome },
    globalSetup: ["test/global-setup.ts"],
    coverage: {
      // Include every source file so untested ones show as 0% rather
      // than being silently omitted from the report. v8 coverage
      // otherwise hides files that no test imports, which makes it
      // easy to think we have better coverage than we do.
      include: ["src/**/*.ts", "scripts/**/*.mjs"],
      // `src/index.ts` is the stdio CLI entry point — 7 lines that
      // call `runServer({ argv, env })` and forward the rejection
      // to `process.exit(1)`. Testing it requires booting a real
      // `StdioServerTransport`, which deadlocks the test runner
      // waiting for the next stdio frame. The orchestration the
      // shim wraps lives in `runtime.ts` and is covered there.
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/index.ts",
        // `prod-readonly-test.mjs` is a top-level smoke test that
        // spawns `dist/index.js` and walks a real Gmail token —
        // mocking it in vitest would defeat its purpose. It runs
        // pre-release against a sandbox token, not in the unit
        // test suite.
        "scripts/prod-readonly-test.mjs",
      ],
    },
  },
});
