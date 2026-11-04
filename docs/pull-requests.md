# Pull requests

The repo left klodr/gmail-mcp's fork network on GitHub, which removed its pull request pages. Their descriptions are kept here, newest first. None had review comments.

## 5. chore: rename to google-mcp and rewrite the README for teammates

Branch `chore/google-mcp-cleanup`, merged 2026-11-04.

The repo now presents as our Google MCP, and a teammate can set it up from the README alone.

**README:** a setup guide for someone with their own Google Cloud OAuth client. It covers the six APIs, an Internal consent screen, a Desktop client, the build, the sign-in with the full scope list, and registration with Claude Code. It also has the tool families by scope, the safeguards, and troubleshooting.

**Rename:** the package is `google-mcp` and marked private, and the server reports its name as `google`. Auth hints in error messages point at `npm run auth`. The data folder `~/.gmail-mcp` and the `GMAIL_MCP_*` variables keep their names, so existing sign-ins keep working.

**Removed:** upstream's npm, Docker, and release workflows, plus CodeQL, Scorecard, Qodo, CodeRabbit, Codecov, Socket, and Dependabot. Also the MCP registry entry, the sponsor links, the issue templates, and upstream's roadmap, security, and competitor docs. CI runs lint, build, and tests.

**Fixed:** lint and Prettier failed on main. Five files are reformatted, and `drive_read_file` turns a non-string export or cell into JSON instead of `[object Object]`.

Build, lint, format check, and all 793 tests pass locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## 4. feat(docs): links, italics, and numbered lists in docs_write_tab

Branch `feat/docs-links-italics`, merged 2026-10-22.

The only route to a clickable link in a Google Doc was a .docx upload. That route loses the tabs, the column widths, and the table style, so sessions took it whenever a doc had sources to cite.

Changes:

- `docs_write_tab` markdown renders `[text](url)` as a link. Only http, https, and mailto URLs count; the link is underlined in Docs' link blue `#1155CC`.
- `*italic*` and `_italic_` render as italics. A marker opens only at a word start and closes only at a word end, so `snake_case` and `2 * 3` stay literal.
- A run of `1. ` lines becomes one numbered list, made by one `createParagraphBullets` request per run.
- Markers do not nest. Links inside table cells are not supported.
- `docs_read_tab` reads links, italics, and numbered items back as markdown.
- The parser, the request builder, and the read-back helpers move from `docs.ts` into the pure module `src/tools/docs-markdown.ts`, with 21 tests in `docs-markdown.test.ts`.

Checks: `vitest run` passes 811 of 811, and typecheck and Prettier are clean. `npm run lint` reports the same three errors in `src/tools/drive.ts` that `main` has.

Not yet verified against the live Docs API: the link styling and the numbering of a multi-item run. Both get checked on a scratch doc after the build.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## 3. fix(tools): route docs and decks to the native builders in descriptions

Branch `feat/house-doc-route`, merged 2026-10-22.

A session asked for "a Google Doc" converted its markdown to .docx with pandoc and uploaded it. The result had no tabs, no column widths, and no table style. The descriptions sent it there. `drive_upload_file` said to use it when "a deck, doc, or sheet was built locally", and `docs_create_release_doc` said it was for release notes.

Changes, descriptions only (tool names unchanged):

- `drive_upload_file`:
  - USE WHEN covers a locally built deck or sheet, or an Office file the user hands over.
  - DO NOT USE sends a doc written from text to `docs_create_release_doc` and `docs_write_tab`.
- `docs_create_release_doc` covers any new doc and names `tabTitles` for a single tab.
- `docs_write_tab`:
  - covers any tab;
  - says a call writes its table before its markdown;
  - says `replace` removes other people's edits and comment anchors.
- `slides_create_deck_from_outline` is for an unbranded deck. A branded deck is built locally and uploaded, and `slides_append_to_deck` says the same.
- `src/tools-routing.test.ts` pins the routing lines.

Checks: `vitest run` passes 790 of 790, and typecheck and Prettier are clean. `npm run lint` reports three errors in `src/tools/drive.ts` (`no-base-to-string` at lines 136, 345, and 358). Those errors are also on `main`, and this change does not touch that file.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## 2. feat(docs): docs_locate_comments ties each comment to its table row

Branch `feat/docs-locate-comments`, merged 2026-10-10.

## Summary

On a Google Doc built around tables, a comment's quoted text can't tell you which row the comment is about. The quote is a snapshot from when the comment was made, so it goes stale when someone edits the cell. A comment attached to a single word, such as "Drop", can match hundreds of cells. The Docs API and the markdown export both drop comments, so none of the existing tools could place one.

The Doc's HTML export marks each open comment where it sits now, with an inline `cmnt_refN` anchor, and puts the comment bodies at the end. The new `docs_locate_comments` tool makes three calls in parallel: it exports the HTML, pages through `comments.list`, and reads the tab titles from `documents.get`. Then it ties each API thread to its anchor by matching text. Each thread comes back with its tab and heading path. For a table cell it also gets the row key, the column, and the cell text.

## Changes

- **New tool:** `docs_locate_comments` in `src/tools/docs.ts`. It takes `tabTitle` and `mentions` filters and an `includeFullRow` option. A size limit keeps the result inline, and `coverage.notes` says what the tool filtered, dropped, or could not place.
- **Parser and join:** `src/doc-comment-locations.ts`, with no API calls.
  - Threads are matched by text, never by position, because one cell can hold several threads and `comments.list` lists the newest first.
  - When a thread's opening text appears more than once, the tool picks the anchor followed by the most of that thread's replies. A tie comes back as `ambiguous` with both candidates.
- **Fix:** `drive_list_comments` now asks the API for `replies(action)`. Before, a resolve or reopen reply looked the same as a blank reply. It also asks for `assigneeEmailAddress` and `mentionedEmailAddresses`.
- **Shared helpers:** `drive.ts` now exports `getResolvedFileMeta` and `DOC_MIME`.

## Dependency

`htmlparser2` is pinned at 12.0.0 and adds 6 packages to `package-lock.json`. I chose a SAX parser for two reasons. A regex breaks on nested markup and would need its own entity decoder. `parse5` would build a full DOM for an export that can run to megabytes.

## Checks

- `npm test` passes all 786 tests, 41 of them new. A code review of the first commit found ten gaps, and the second commit fixes them. They include merged cells, comments on headings, resolved threads matched against open ones, and the size limit. Each of the ten new tests fails on the first commit.
  - `src/doc-comment-locations.test.ts` runs the parser and join against synthetic fixtures shaped like the export.
  - `src/tools/docs.test.ts` is the first registrar test for the Docs family.
- `npm run build` passes.
- `npm run lint` reports the same 3 errors in `src/tools/drive.ts` that `main` has, so this branch adds none.
- `npm run format:check` reports the same 6 files that `main` has, so this branch adds none.
- Live check on a two-tab review checklist with 11 threads and a 2.1 MB export:
  - The tool placed all 10 open threads on the rows found by hand.
  - The resolved thread came back unplaced, with its reason.
  - Each resolve and reopen reply came back with its `action`.
  - Each call took about 7 seconds, including server start.
- I haven't checked `documents.get` live on a token that has only `drive.readonly`. If that call fails, locations come back with `tab: null`, and a note in the result says so.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## 1. feat(drive): drive_upload_file with convert-on-upload and in-place replace

Branch `feat/drive-upload-file`, merged 2026-09-16.

## Why

A deck built locally on the Newton template had no way into Google Slides except a hand upload. The MCP had no upload call, and the Slides API has no theme-import call, so nothing could apply the theme after the fact. Drive's own importer keeps the theme when a pptx is converted on upload, which makes one upload tool the whole fix.

## What

- `drive_upload_file`: `files.create` with multipart media; converts `.pptx`/`.docx`/`.xlsx`/`.csv` to the Google-native type by default. `replaceFileId` runs `files.update` with media so the file keeps its ID, URL, and sharing.
- Source path jailed to `GMAIL_MCP_ATTACHMENT_DIR` or `GMAIL_MCP_DOWNLOAD_DIR` via the new exported `assertReadablePathInJail`; the `send_email` attachment check is now a one-jail call to it.
- 5 MB cap, refused before any API call (multipart limit; resumable upload is a follow-up).
- `scopes: ["drive"]` only; wired into `WRITE_TOOLS` and the `workspace_writes` bucket.
- `src/tools/drive.test.ts`: first registrar test for the Drive family, 17 cases.

## Checks

- `npm run typecheck`, `npm test` (745 passed), `npm run build`: green.
- `npm run lint`: 3 pre-existing `no-base-to-string` errors in `drive.ts` (present on `main`, untouched here).
- `npm run format:check`: 6 pre-existing warnings in files this PR does not touch; the touched files are clean.

## Left for the first live run

Whether Drive re-converts a pptx onto an existing Slides file through `replaceFileId`. The handler returns the result's `mimeType` so a non-conversion is visible.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
