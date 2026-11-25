/**
 * Conversions between plain text and HTML for message bodies.
 */

import { Parser } from "htmlparser2";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Minimal plain-text-to-HTML converter: each blank-line-separated
 * chunk becomes a `<p>`, and a newline inside one becomes `<br>`.
 * Anything fancier (Markdown, lists) is the caller's to express as
 * HTML.
 */
export function textToHtml(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

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
  // Each open link collects its own text, so closing one never rereads `out`.
  const openLinks: Array<{ href: string; text: string }> = [];

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (DROPPED.has(name)) {
          dropDepth++;
          return;
        }
        if (dropDepth > 0) return;

        if (name === "br" || BLOCK.has(name)) out += "\n";
        if (name === "a") openLinks.push({ href: attribs.href ?? "", text: "" });
        if (name === "img" && /^https?:/i.test(attribs.src ?? "")) {
          out += `[image: ${attribs.alt?.trim() || attribs.src}]`;
        }
      },

      ontext(text) {
        if (dropDepth > 0) return;
        const collapsed = text.replace(/\s+/g, " ");
        out += collapsed;
        for (const link of openLinks) link.text += collapsed;
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
            const text = link.text.trim();
            if (text === "") out += link.href;
            else if (text !== link.href.replace(/^mailto:/i, "")) out += ` <${link.href}>`;
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
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
