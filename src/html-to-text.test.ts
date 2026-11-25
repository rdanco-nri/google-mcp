import { describe, it, expect } from "vitest";
import { htmlToText } from "./html-to-text.js";

describe("htmlToText", () => {
  it("keeps a link's address beside its text, once", () => {
    expect(htmlToText('<a href="https://example.com/a?x=1&amp;y=2">View request</a>')).toBe(
      "View request <https://example.com/a?x=1&y=2>",
    );
    // Text that repeats the address, or no text at all, leaves the address alone.
    expect(htmlToText('<a href="https://example.com/a">https://example.com/a</a>')).toBe(
      "https://example.com/a",
    );
    expect(htmlToText('<a href="https://example.com/a"></a>')).toBe("https://example.com/a");
  });

  it("ends a line at a block element, a <br>, and a table row, and spaces table cells", () => {
    const html =
      "<p>First paragraph.</p><ul><li>Name: Newton</li><li>Stage: Open</li></ul>" +
      "<div>Line one<br>Line two</div>" +
      "<table><tr><td>Owner</td><td>Rob</td></tr><tr><td>Due</td><td>Friday</td></tr></table>";
    expect(htmlToText(html).split("\n").filter(Boolean)).toEqual([
      "First paragraph.",
      "Name: Newton",
      "Stage: Open",
      "Line one",
      "Line two",
      "Owner Rob",
      "Due Friday",
    ]);
  });

  it("names an image at a web address and leaves an inline one out", () => {
    expect(htmlToText('<img src="https://cdn.example.com/logo.png" alt="Kohler">')).toBe(
      "[image: Kohler]",
    );
    expect(htmlToText('<img src="https://cdn.example.com/logo.png">')).toBe(
      "[image: https://cdn.example.com/logo.png]",
    );
    expect(htmlToText('<img src="cid:part1.png" alt="chart">')).toBe("");
  });

  it("drops style, script, head, and title contents", () => {
    const html =
      "<head><title>Kohler</title><meta charset='utf-8'></head>" +
      "<style>p { margin: 0 !important; }</style><script>track()</script><p>Body</p>";
    expect(htmlToText(html)).toBe("Body");
    // A body that is only styling shows a reader nothing.
    expect(htmlToText("<style>p { margin: 0; }</style><div> &nbsp; </div>")).toBe("");
  });

  it("collapses whitespace and never stacks blank lines", () => {
    const html =
      "<div>\n   <div>Spread \n\t  out&nbsp;&nbsp;text</div>\n\n</div><div></div><p>Next</p>";
    expect(htmlToText(html)).toBe("Spread out text\n\nNext");
  });
});
