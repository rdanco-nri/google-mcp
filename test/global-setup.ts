import { rmSync } from "node:fs";

// Removes the throwaway HOME that vitest.config.ts creates for this run.
export default function setup(): () => void {
  return () => {
    const home = process.env.GOOGLE_MCP_TEST_HOME;
    if (home) rmSync(home, { recursive: true, force: true });
  };
}
