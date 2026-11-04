# google-mcp

google-mcp lets Claude read and act on your Google account across Gmail, Drive, Docs, Sheets, Slides, and Calendar. It's an MCP server that runs on your own machine, signs in with your own Google Cloud OAuth client, and hands Claude only the tools your sign-in allows.

We use it every day at Newton through Claude Code. Setup takes about 20 minutes, and most of that is the Google Cloud Console.

## Tools

Each family of tools appears only when your sign-in grants its scope.

| Family | Tools | Scope it needs |
|---|---|---|
| Gmail: read | `search_emails`, `read_email`, `get_thread`, `list_inbox_threads`, `get_inbox_with_threads`, `list_email_labels`, `download_email`, `download_attachment`, `list_drafts`, `get_draft` | `gmail.readonly` or `gmail.modify` |
| Gmail: write | `send_email`, `draft_email`, `update_draft`, `send_draft`, `delete_draft`, `reply_to_email`, `reply_all`, `forward_email`, `modify_email`, `modify_thread`, `batch_modify_emails`, `create_label`, `update_label`, `delete_label`, `get_or_create_label`, `pair_recipient` | `gmail.modify` |
| Gmail: filters | `list_filters`, `get_filter`, `create_filter`, `create_filter_from_template`, `delete_filter` | `gmail.settings.basic` |
| Drive | `drive_search`, `drive_get_metadata`, `drive_read_file`, `drive_download_file`, `drive_list_shared_drives`, `drive_list_comments`, `docs_locate_comments`, `drive_reply_to_comment`, `drive_trash_file`, `drive_upload_file` | `drive` |
| Docs | `docs_create_release_doc`, `docs_write_tab`, `docs_read_tab` | `documents` |
| Sheets | `sheets_write_tab` | `spreadsheets` |
| Slides | `slides_create_deck_from_outline`, `slides_append_to_deck` | `presentations` |
| Calendar | `calendar_list_events`, `calendar_find_free_slots` | `calendar.readonly` |

Calendar is read-only. `drive_read_file` turns a Doc into markdown, a Sheet into CSV with every tab, and a deck into an outline. Permanent delete (`delete_email`, `batch_delete_emails`) needs the extra `mail.google.com` scope, which the setup below leaves out on purpose; `modify_email` can still move mail to Trash.

## Before you start

You need:

- **Node.js 22.22.2 or later:** check with `node -v`.
- **Claude Code**, or another MCP client such as Claude Desktop or Cursor.
- **Your newtonresearch.ai Google account**, which can create a Google Cloud project.

## 1. Create your Google OAuth client

Each person makes their own client, so your tokens never touch anyone else's project.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) signed in as your work account, and create a project, for example `google-mcp-<yourname>`. Set its organization to newtonresearch.ai; a project under "No organization" can't offer the Internal option in step 3.
2. Under **APIs & Services → Library**, enable the Gmail, Google Drive, Google Docs, Google Sheets, Google Slides, and Google Calendar APIs. A missing API shows up later as a 403 error that says the API "has not been used in project".
3. Under **APIs & Services → OAuth consent screen**, set up the consent screen. Choose the **Internal** user type. Internal keeps the app inside newtonresearch.ai, skips Google's app review, and avoids the 7-day token expiry that External apps in testing get.
4. Under **APIs & Services → Credentials**, choose **Create credentials → OAuth client ID**, and pick **Desktop app** as the type.
5. Download the client's JSON file, and save it as `~/.google-mcp/gcp-oauth.keys.json`:

   ```bash
   mkdir -p ~/.google-mcp
   mv ~/Downloads/client_secret_*.json ~/.google-mcp/gcp-oauth.keys.json
   ```

## 2. Build the server

```bash
git clone https://github.com/rdanco-nri/google-mcp.git ~/workspace/google-mcp
cd ~/workspace/google-mcp
npm install
npm run build
```

The build writes the server to `dist/index.js`. The clone can live anywhere; the steps below assume `~/workspace/google-mcp`.

## 3. Sign in

From the `google-mcp` folder, run:

```bash
npm run auth -- --scopes=gmail.modify,gmail.settings.basic,drive,spreadsheets,presentations,documents,calendar.readonly
```

A browser opens on Google's consent screen. Approve it, and the server saves your tokens to `~/.google-mcp/credentials.json`, readable only by you.

The sign-in listens on port 3000. If another program holds that port, add a different callback address to the end of the command, such as `http://localhost:8080/oauth2callback`.

That scope list is the full set we use day to day. Every scope you leave out hides its tools from Claude, so a narrower list works too. For example, `--scopes=gmail.readonly` gives a read-only Gmail.

To add a scope later, run the command again with the **whole** list you want. The server replaces its saved list with what you pass. A shorter list hides tools you had before, even though Google still holds the grant.

## 4. Connect it to Claude

For Claude Code, register the server once for all your projects:

```bash
claude mcp add google -s user -- node ~/workspace/google-mcp/dist/index.js
```

Then restart Claude Code. The tools show up as `mcp__google__<tool>`, for example `mcp__google__search_emails`.

For Claude Desktop or Cursor, add this to the client's MCP config, with the full path to your clone:

```json
{
  "mcpServers": {
    "google": {
      "command": "node",
      "args": ["/Users/<you>/workspace/google-mcp/dist/index.js"]
    }
  }
}
```

Claude Desktop keeps its config at `~/Library/Application Support/Claude/claude_desktop_config.json`, and Cursor at `~/.cursor/mcp.json`. If you installed Node through nvm, the app may not find `node`, so put the full path from `which node` in `command`.

To check it works, ask Claude to list your Gmail labels.

## Updating

```bash
cd ~/workspace/google-mcp
git pull
npm install
npm run build
```

Then restart your MCP client, which loads `dist/index.js` only at startup.

## Safeguards

The server limits what a prompt hidden in an email or doc could make Claude do.

- **Outgoing files come from known folders:** an email attachment must sit in `~/GoogleMCP/attachments`, and a Drive upload in `~/GoogleMCP/attachments` or `~/GoogleMCP/downloads`. A request to attach `~/.ssh/id_rsa` fails before it reaches Google.
- **Downloads land in one folder:** downloaded emails, attachments, and Drive files go to `~/GoogleMCP/downloads`.
- **Writes are rate-limited:** the default caps include 100 sends a day and 200 deletes a day.
- **Every tool says what it does:** each tool tells the client whether it only reads or can change or delete data, so the client can ask you before it runs.

These settings change through environment variables. In Claude Code, pass each one with `-e` when you register the server, for example `claude mcp add google -s user -e GOOGLE_MCP_DRY_RUN=true -- node ~/workspace/google-mcp/dist/index.js`; run `claude mcp remove google -s user` first to change an existing entry. In other clients, put them in the config's `env` block. `.env.example` lists each one with its default:

| Variable | Effect |
|---|---|
| `GOOGLE_MCP_ATTACHMENT_DIR` | Folder that outgoing attachments and uploads come from |
| `GOOGLE_MCP_DOWNLOAD_DIR` | Folder that downloads go to |
| `GOOGLE_MCP_DRY_RUN=true` | Every write returns what it would have sent, without sending it |
| `GOOGLE_MCP_AUDIT_LOG=/abs/path.jsonl` | Logs every tool call, with message content left out |
| `GOOGLE_MCP_RECIPIENT_PAIRING=true` | Sends only to addresses on an allowlist kept by `pair_recipient` |
| `GOOGLE_MCP_RATE_LIMIT_send=400/day,6000/month` | Changes one rate-limit cap; the other buckets are `delete`, `modify`, `drafts`, `labels`, `filters`, and `workspace_writes` |

## Troubleshooting

- **A tool says the sign-in expired or returns `invalid_grant`:** run the step 3 command again.
- **A call returns 403 "API has not been used in project":** enable that API in your Cloud project, wait a minute, and retry.
- **Claude doesn't see a tool you expect:** your sign-in lacks its scope. Run step 3 again with the full list.
- **`npm run auth` says it can't find OAuth keys:** check that the file sits at `~/.google-mcp/gcp-oauth.keys.json`.

## Development

```bash
npm test             # unit tests
npm run lint         # ESLint
npm run format:check # Prettier
npm run build        # typecheck and bundle
```

`CHANGELOG.md` records each change, and CI runs lint, build, and tests on every pull request.

## License

MIT. google-mcp started as a fork of [GongRzhe/Gmail-MCP-Server](https://github.com/GongRzhe/Gmail-MCP-Server), by way of [ArtyMcLabin/Gmail-MCP-Server](https://github.com/ArtyMcLabin/Gmail-MCP-Server) and [klodr/gmail-mcp](https://github.com/klodr/gmail-mcp). The Drive, Docs, Sheets, Slides, and Calendar tools were built here. See [LICENSE](./LICENSE).
