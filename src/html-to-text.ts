/**
 * Plain-text rendering of an HTML email body, for the text/plain
 * alternative of a message that quotes one.
 */

import { Parser } from "htmlparser2";

const DROPPED = new Set(["style", "script", "head", "title"]);

const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tr",
  "ul",
]);

const CELL = new Set(["td", "th"]);

/**
 * Converts HTML to text a reader can follow without the markup.
 *
 * - A link reads `text <url>`, or the address alone when the text
 *   repeats it or is empty.
 * - A line ends at a block element, `<br>`, or a table row; a table
 *   cell ends with a space.
 * - An image at a web address reads `[image: alt]`, or its address
 *   when it has no alt text. An inline (`cid:`) image leaves nothing.
 * - `<style>`, `<script>`, `<head>`, and `<title>` contents are dropped.
 * - Runs of whitespace collapse, and blank lines never stack.
 *
 * @returns The text, or an empty string when the HTML shows a reader nothing
 */
export function htmlToText(html: string): string {
  let out = "";
  let dropDepth = 0;
  const openLinks: Array<{ href: string; start: number }> = [];

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (DROPPED.has(name)) {
          dropDepth++;
          return;
        }
        if (dropDepth > 0) return;

        if (name === "br" || BLOCK.has(name)) out += "\n";
        if (name === "a") openLinks.push({ href: attribs.href ?? "", start: out.length });
        if (name === "img" && /^https?:/i.test(attribs.src ?? "")) {
          out += `[image: ${attribs.alt?.trim() || attribs.src}]`;
        }
      },

      ontext(text) {
        if (dropDepth === 0) out += text.replace(/\s+/g, " ");
      },

      onclosetag(name) {
        if (DROPPED.has(name)) {
          dropDepth = Math.max(0, dropDepth - 1);
          return;
        }
        if (dropDepth > 0) return;

        if (name === "a") {
          const link = openLinks.pop();
          if (link && /^(https?|mailto):/i.test(link.href)) {
            const text = out.slice(link.start).trim();
            if (text === "") out += link.href;
            else if (text !== link.href) out += ` <${link.href}>`;
          }
        }
        if (CELL.has(name)) out += " ";
        if (BLOCK.has(name)) out += "\n";
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();

  return out
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
