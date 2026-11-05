import { describe, it, expect } from "vitest";
import { DownloadAttachmentSchema } from "./tools.js";

describe("DownloadAttachmentSchema", () => {
  it("accepts a Gmail attachment ID longer than 256 chars", () => {
    const attachmentId = "ANGjdJ" + "a".repeat(600);
    expect(DownloadAttachmentSchema.parse({ messageId: "1a1a8db67f4f8e83", attachmentId }).attachmentId).toBe(attachmentId);
  });

  it("still caps the message ID at 256 chars", () => {
    expect(() => DownloadAttachmentSchema.parse({ messageId: "a".repeat(257), attachmentId: "x" })).toThrow();
  });

  it("rejects an attachment ID past 2048 chars", () => {
    expect(() => DownloadAttachmentSchema.parse({ messageId: "m", attachmentId: "a".repeat(2049) })).toThrow();
  });
});
