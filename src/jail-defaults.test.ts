/**
 * Default jail folders: with no override set, attachments and downloads
 * resolve under ~/GoogleMCP, and neither jail admits the other's files.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertReadablePathInJail, getDownloadDir, resetJailDirCache } from "./utl.js";

const ENV_KEYS = ["GOOGLE_MCP_ATTACHMENT_DIR", "GOOGLE_MCP_DOWNLOAD_DIR"] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string>>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetJailDirCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetJailDirCache();
});

describe("default jail folders", () => {
  it("puts downloads in ~/GoogleMCP/downloads at mode 0o700", () => {
    const dir = getDownloadDir();
    expect(dir).toBe(fs.realpathSync(path.join(os.homedir(), "GoogleMCP", "downloads")));
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("reads attachments from ~/GoogleMCP/attachments", () => {
    const file = path.join(os.homedir(), "GoogleMCP", "attachments", "a.txt");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");
    expect(assertReadablePathInJail(file, { jails: ["attachment"], kind: "attachment" })).toBe(
      fs.realpathSync(file),
    );
  });

  it("keeps a download out of the attachment jail", () => {
    const file = path.join(getDownloadDir(), "d.txt");
    fs.writeFileSync(file, "x");
    expect(() =>
      assertReadablePathInJail(file, { jails: ["attachment"], kind: "attachment" }),
    ).toThrow();
  });
});
