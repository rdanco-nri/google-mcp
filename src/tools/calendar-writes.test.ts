/**
 * The calendar write tools and the invite reader over the real MCP
 * round-trip (Client → SDK → defineTool → middleware → handler → mock
 * Calendar and Gmail clients), the same path `calendar.test.ts` uses.
 *
 * Each test gets its own state dir and paired-recipient file, so the
 * rate-limit ledger and the pairing gate never touch the host's files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { calendar_v3, gmail_v1 } from "googleapis";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { apiError } from "../test-fixtures/google.js";
import { resetRateLimitHistory } from "../rate-limit.js";
import { _setMeetRetryMs, eventIdFor, mergeGuests } from "./calendar.js";
import {
  COUNTER_ICS,
  GUEST,
  OCCURRENCE_ID,
  ORGANIZER,
  REQUEST_ICS,
  SERIES_ID,
  b64url,
  eventLink,
} from "../test-fixtures/invites.js";

type Event = calendar_v3.Schema$Event;
type Params = Record<string, unknown> & { requestBody?: Event };
type Call = { method: string; params: Params; options?: unknown };

/** The account. In the invite fixtures it organizes the meeting. */
const ME = ORGANIZER;
const NY = "America/New_York";

interface Mocks {
  event?: Event;
  get?: (p: Params) => Event | Promise<Event>;
  patch?: (p: Params, attempt: number) => Event | Promise<Event>;
  insert?: (p: Params) => Event | Promise<Event>;
  list?: (p: Params) => { items: Event[] };
  instances?: (p: Params) => { items: Event[] };
  message?: gmail_v1.Schema$Message;
  messageError?: Error;
  attachment?: string;
}

function clients(m: Mocks) {
  const calls: Call[] = [];
  const record = (method: string, params: Params, options?: unknown) =>
    calls.push({ method, params, options });
  let patches = 0;
  const calendar = {
    events: {
      get: async (p: Params) => {
        record("get", p);
        return { data: m.get ? await m.get(p) : (m.event ?? {}) };
      },
      patch: async (p: Params, options?: unknown) => {
        record("patch", p, options);
        const attempt = patches++;
        return { data: m.patch ? await m.patch(p, attempt) : { ...m.event, ...p.requestBody } };
      },
      insert: async (p: Params) => {
        record("insert", p);
        return {
          data: m.insert
            ? await m.insert(p)
            : {
                ...p.requestBody,
                status: "confirmed",
                htmlLink: "https://calendar.example/e",
                organizer: { email: ME, self: true },
              },
        };
      },
      list: async (p: Params) => {
        record("list", p);
        return { data: m.list ? m.list(p) : { items: [] } };
      },
      instances: async (p: Params) => {
        record("instances", p);
        return { data: m.instances ? m.instances(p) : { items: [] } };
      },
    },
    freebusy: { query: async () => ({ data: { calendars: {} } }) },
  };
  const gmail = {
    users: {
      messages: {
        get: async (p: Params) => {
          record("gmail.get", p);
          if (m.messageError) throw m.messageError;
          if (!m.message) throw apiError(404, "Requested entity was not found.");
          return { data: m.message };
        },
        attachments: {
          get: async (p: Params) => {
            record("gmail.attachment", p);
            return { data: { data: m.attachment } };
          },
        },
      },
    },
  };
  return { calls, calendar, gmail };
}

async function connect(m: Mocks, scopes = ["calendar.events", "gmail.modify"]) {
  const { calls, calendar, gmail } = clients(m);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const server = createServer({ calendar, gmail, authorizedScopes: scopes } as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "calendar-writes-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    return { ...res, text: res.content[0]?.text ?? "" };
  };
  return {
    call,
    calls,
    of: (method: string) => calls.filter((c) => c.method === method),
    tools: async () => (await client.listTools()).tools.map((t) => t.name),
    close: () => Promise.all([client.close(), server.close()]),
  };
}

let stateDir: string;
const originalEnv = { ...process.env };
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "google-mcp-calendar-writes-"));
  process.env.GOOGLE_MCP_STATE_DIR = stateDir;
  process.env.GOOGLE_MCP_PAIRED_PATH = join(stateDir, "paired.json");
  delete process.env.GOOGLE_MCP_RECIPIENT_PAIRING;
  delete process.env.GOOGLE_MCP_RATE_LIMIT_DISABLE;
  delete process.env.GOOGLE_MCP_DRY_RUN;
  resetRateLimitHistory();
  _setMeetRetryMs(0);
});
afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  process.env = { ...originalEnv };
  resetRateLimitHistory();
});

/** One occurrence of a weekly series the account organizes: Tue Nov 17, 12:30-13:00 New York. */
const occurrence = (over: Event = {}): Event => ({
  id: OCCURRENCE_ID,
  etag: '"etag-1"',
  status: "confirmed",
  summary: "Guest / Org Biweekly",
  start: { dateTime: "2026-11-17T12:30:00-05:00", timeZone: NY },
  end: { dateTime: "2026-11-17T13:00:00-05:00", timeZone: NY },
  recurringEventId: SERIES_ID,
  originalStartTime: { dateTime: "2026-11-17T12:30:00-05:00", timeZone: NY },
  organizer: { email: ME, self: true },
  attendees: [
    { email: ME, self: true, organizer: true, responseStatus: "accepted" },
    { email: GUEST, responseStatus: "accepted", comment: "see you" },
  ],
  htmlLink: "https://calendar.example/e",
  ...over,
});

describe("calendar write tool registration", () => {
  it("advertises the writes only on a calendar.events token", async () => {
    const writer = await connect({}, ["calendar.events"]);
    const reader = await connect({}, ["calendar.readonly"]);
    const writes = ["calendar_respond_to_event", "calendar_update_event", "calendar_create_event"];
    expect(await writer.tools()).toEqual(expect.arrayContaining(writes));
    const readerTools = await reader.tools();
    for (const w of writes) expect(readerTools).not.toContain(w);
    expect(readerTools).toContain("calendar_read_invite_email");
    expect(readerTools).toContain("calendar_list_events");
    await Promise.all([writer.close(), reader.close()]);
  });

  it("points a missing-scope 403 at re-authorizing with calendar.events", async () => {
    const fix = await connect({
      get: () => {
        throw apiError(403, "Request had insufficient authentication scopes.");
      },
    });
    const res = await fix.call("calendar_respond_to_event", {
      eventId: OCCURRENCE_ID,
      response: "accepted",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("calendar.events");
    expect(res.text).toContain("npm run auth");
    await fix.close();
  });
});

describe("calendar_respond_to_event", () => {
  /** What events.get returns with maxAttendees: 1 -- just the account's own entry. */
  const invite = (self: calendar_v3.Schema$EventAttendee = {}): Event => ({
    id: OCCURRENCE_ID,
    summary: "Ads sync",
    start: { dateTime: "2026-11-19T15:00:00-05:00", timeZone: NY },
    end: { dateTime: "2026-11-19T15:30:00-05:00", timeZone: NY },
    organizer: { email: "host@vendor.example" },
    attendees: [{ email: ME, self: true, responseStatus: "needsAction", ...self }],
  });

  it("sends only the account's own entry, so no other guest's reply can be overwritten", async () => {
    const fix = await connect({ event: invite() });
    const res = await fix.call("calendar_respond_to_event", {
      eventId: OCCURRENCE_ID,
      response: "accepted",
      note: "Looking forward to it",
    });
    expect(res.isError).toBeFalsy();
    expect(fix.of("get")[0]?.params.maxAttendees).toBe(1);
    const patch = fix.of("patch")[0]!.params;
    expect(patch.sendUpdates).toBe("all");
    expect(patch.requestBody).toEqual({
      attendeesOmitted: true,
      attendees: [{ email: ME, responseStatus: "accepted", comment: "Looking forward to it" }],
    });
    expect(res.text).toContain("RSVP set to accepted");
    expect(res.text).toContain("host@vendor.example");
    expect(res.structuredContent?.changed).toBe(true);
    await fix.close();
  });

  it("changes nothing and emails no one when the answer already stands", async () => {
    const fix = await connect({ event: invite({ responseStatus: "accepted" }) });
    const res = await fix.call("calendar_respond_to_event", {
      eventId: OCCURRENCE_ID,
      response: "accepted",
    });
    expect(fix.of("patch")).toHaveLength(0);
    expect(res.structuredContent?.changed).toBe(false);
    expect(res.text).toContain("no one was emailed");
    await fix.close();
  });

  it("keeps the existing note when none is given, and honors notify: false", async () => {
    const fix = await connect({
      event: invite({ responseStatus: "accepted", comment: "earlier" }),
    });
    await fix.call("calendar_respond_to_event", {
      eventId: OCCURRENCE_ID,
      response: "tentative",
      notify: false,
    });
    const patch = fix.of("patch")[0]!.params;
    expect(patch.sendUpdates).toBe("none");
    expect(patch.requestBody?.attendees?.[0]?.comment).toBe("earlier");
    await fix.close();
  });

  it("refuses an event with no guest entry for the account, pointing at the invite reader", async () => {
    const fix = await connect({ event: { ...invite(), attendees: [] } });
    const res = await fix.call("calendar_respond_to_event", {
      eventId: OCCURRENCE_ID,
      response: "declined",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("calendar_read_invite_email");
    expect(fix.of("patch")).toHaveLength(0);
    await fix.close();
  });

  it("explains a 404 as an invite that may not be on the calendar yet", async () => {
    const fix = await connect({
      get: () => {
        throw apiError(404, "Not Found");
      },
    });
    const res = await fix.call("calendar_respond_to_event", {
      eventId: OCCURRENCE_ID,
      response: "accepted",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("added from Gmail");
    await fix.close();
  });
});

describe("calendar_update_event", () => {
  it("moves one occurrence and keeps its length when only the start is given", async () => {
    // The proposal case: Wed Nov 18 at 16:00 New York, 30 minutes like the original.
    const fix = await connect({ event: occurrence() });
    const res = await fix.call("calendar_update_event", {
      eventId: OCCURRENCE_ID,
      start: "2026-11-18T16:00:00",
    });
    expect(res.isError).toBeFalsy();
    const { params, options } = fix.of("patch")[0]!;
    expect(params.eventId).toBe(OCCURRENCE_ID);
    expect(params.sendUpdates).toBe("all");
    expect(params.requestBody).toEqual({
      start: { dateTime: "2026-11-18T21:00:00.000Z", timeZone: NY },
      end: { dateTime: "2026-11-18T21:30:00.000Z", timeZone: NY },
    });
    // No guest change, so no ETag guard: an unrelated reply must not fail the move.
    expect(options).toBeUndefined();
    expect(res.text).toContain("Only this occurrence changed");
    expect(res.text).toContain(`Emailed: ${GUEST}`);
    await fix.close();
  });

  it("refuses an event the account doesn't organize", async () => {
    const fix = await connect({
      event: occurrence({ organizer: { email: "host@vendor.example", self: false } }),
    });
    const res = await fix.call("calendar_update_event", { eventId: OCCURRENCE_ID, title: "x" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("calendar_respond_to_event");
    expect(fix.of("patch")).toHaveLength(0);
    await fix.close();
  });

  it("refuses a whole series unless applyToSeries is set", async () => {
    const series = occurrence({
      id: SERIES_ID,
      recurringEventId: undefined,
      recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2"],
    });
    const fix = await connect({ event: series });
    const refused = await fix.call("calendar_update_event", { eventId: SERIES_ID, title: "New" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("applyToSeries");
    expect(fix.of("patch")).toHaveLength(0);
    const allowed = await fix.call("calendar_update_event", {
      eventId: SERIES_ID,
      title: "New",
      applyToSeries: true,
    });
    expect(allowed.isError).toBeFalsy();
    expect(fix.of("patch")[0]!.params.requestBody).toEqual({ summary: "New" });
    await fix.close();
  });

  it("adds and removes guests while everyone else keeps their reply, under an ETag guard", async () => {
    const fix = await connect({ event: occurrence() });
    const res = await fix.call("calendar_update_event", {
      eventId: OCCURRENCE_ID,
      addAttendees: ["New Person <New@Example.com>"],
      removeAttendees: [GUEST],
    });
    expect(res.isError).toBeFalsy();
    const { params, options } = fix.of("patch")[0]!;
    expect(params.requestBody?.attendees).toEqual([
      { email: ME, self: true, organizer: true, responseStatus: "accepted" },
      { email: "new@example.com" },
    ]);
    expect(options).toEqual({ headers: { "If-Match": '"etag-1"' } });
    expect(res.structuredContent?.removed).toEqual([GUEST]);
    expect(res.structuredContent?.notified).toEqual(["new@example.com", GUEST]);
    await fix.close();
  });

  it("re-reads and retries once when a reply lands between the read and the write (412)", async () => {
    let gets = 0;
    const fix = await connect({
      get: () =>
        gets++ === 0
          ? occurrence()
          : occurrence({
              etag: '"etag-2"',
              attendees: [
                { email: ME, self: true, responseStatus: "accepted" },
                { email: GUEST, responseStatus: "declined" },
              ],
            }),
      patch: (p, attempt) => {
        if (attempt === 0) throw apiError(412, "Precondition Failed");
        return { ...occurrence(), ...p.requestBody };
      },
    });
    const res = await fix.call("calendar_update_event", {
      eventId: OCCURRENCE_ID,
      addAttendees: ["new@example.com"],
    });
    expect(res.isError).toBeFalsy();
    expect(fix.of("get")).toHaveLength(2);
    const retry = fix.of("patch")[1]!;
    expect(retry.options).toEqual({ headers: { "If-Match": '"etag-2"' } });
    // The fresh reply survives the retry.
    expect(retry.params.requestBody?.attendees?.[1]).toEqual({
      email: GUEST,
      responseStatus: "declined",
    });
    await fix.close();
  });

  it("previews the change and who would be emailed without writing (dryRun)", async () => {
    const fix = await connect({ event: occurrence() });
    const res = await fix.call("calendar_update_event", {
      eventId: OCCURRENCE_ID,
      start: "2026-11-18T16:00:00-05:00",
      dryRun: true,
    });
    expect(fix.of("patch")).toHaveLength(0);
    expect(res.text).toContain("DRY RUN");
    expect(res.text).toContain("Wed Nov 18, 4:00 PM - 4:30 PM EST");
    expect(res.structuredContent?.notified).toEqual([GUEST]);
    await fix.close();
  });

  it("holds an unpaired new guest at the pairing gate, unless no one is emailed", async () => {
    process.env.GOOGLE_MCP_RECIPIENT_PAIRING = "true";
    const fix = await connect({ event: occurrence() });
    const held = await fix.call("calendar_update_event", {
      eventId: OCCURRENCE_ID,
      addAttendees: ["exfil@evil.example"],
    });
    expect(held.isError).toBe(true);
    expect(held.text).toContain("exfil@evil.example");
    expect(fix.of("patch")).toHaveLength(0);
    const quiet = await fix.call("calendar_update_event", {
      eventId: OCCURRENCE_ID,
      addAttendees: ["exfil@evil.example"],
      notify: false,
    });
    expect(quiet.isError).toBeFalsy();
    expect(fix.of("patch")[0]!.params.sendUpdates).toBe("none");
    await fix.close();
  });

  it("rejects bad input before any write", async () => {
    const fix = await connect({
      event: occurrence({
        start: { dateTime: "2026-11-17T17:30:00Z" },
        end: { dateTime: "2026-11-17T18:00:00Z" },
      }),
    });
    const cases: [Record<string, unknown>, string][] = [
      [{}, "Nothing to change"],
      [{ start: "2026-11-18T16:00:00" }, "timeZone"],
      [{ start: "2026-11-18T16:00:00Z", end: "2026-11-18T15:00:00Z" }, "after `start`"],
      [{ start: "2026-11-18" }, "all-day"],
      [{ removeAttendees: ["nobody@example.com"] }, "not a guest"],
    ];
    for (const [args, expected] of cases) {
      const res = await fix.call("calendar_update_event", { eventId: OCCURRENCE_ID, ...args });
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(res.text).toContain(expected);
    }
    expect(fix.of("patch")).toHaveLength(0);
    await fix.close();
  });
});

describe("calendar_create_event", () => {
  const base = {
    title: "Planning",
    start: "2026-11-20T10:00:00",
    end: "2026-11-20T10:30:00",
    timeZone: NY,
    attendees: [GUEST],
  };

  it("creates the event under a deterministic ID and emails the guests", async () => {
    const fix = await connect({});
    const res = await fix.call("calendar_create_event", { ...base, addMeet: false });
    expect(res.isError).toBeFalsy();
    const params = fix.of("insert")[0]!.params;
    expect(params.sendUpdates).toBe("all");
    expect(params.conferenceDataVersion).toBe(0);
    expect(params.requestBody).toMatchObject({
      summary: "Planning",
      start: { dateTime: "2026-11-20T15:00:00.000Z", timeZone: NY },
      end: { dateTime: "2026-11-20T15:30:00.000Z", timeZone: NY },
      attendees: [{ email: GUEST }],
    });
    expect(params.requestBody?.id).toMatch(/^[0-9a-v]{40}$/);
    expect(res.text).toContain(`Invites emailed to: ${GUEST}`);
    await fix.close();
  });

  it("returns the first event on an identical retry instead of booking twice (409)", async () => {
    let existing: Event | undefined;
    const fix = await connect({
      insert: (p) => {
        if (existing) throw apiError(409, "The requested identifier already exists.");
        existing = { ...p.requestBody, status: "confirmed", organizer: { email: ME, self: true } };
        return existing;
      },
      get: () => existing ?? {},
    });
    const first = await fix.call("calendar_create_event", base);
    const second = await fix.call("calendar_create_event", base);
    const ids = fix.of("insert").map((c) => c.params.requestBody?.id);
    expect(ids[0]).toBe(ids[1]);
    expect(first.structuredContent?.alreadyExisted).toBe(false);
    expect(second.structuredContent?.alreadyExisted).toBe(true);
    expect(second.structuredContent?.notified).toEqual([]);
    expect(second.text).toContain("no new invites went out");
    await fix.close();
  });

  it("refuses to revive an identical event that was deleted", async () => {
    const fix = await connect({
      insert: () => {
        throw apiError(409, "The requested identifier already exists.");
      },
      get: (p) => ({ id: p.eventId as string, status: "cancelled" }),
    });
    const res = await fix.call("calendar_create_event", base);
    expect(res.isError).toBe(true);
    expect(res.text).toContain("deleted earlier");
    await fix.close();
  });

  it("asks for a Meet link with a request ID tied to the event, and re-reads a pending one once", async () => {
    const fix = await connect({
      insert: (p) => ({
        ...p.requestBody,
        conferenceData: { createRequest: { status: { statusCode: "pending" } } },
      }),
      get: () => ({ hangoutLink: "https://meet.google.com/abc-defg-hij" }),
    });
    const res = await fix.call("calendar_create_event", { ...base, addMeet: true });
    const params = fix.of("insert")[0]!.params;
    expect(params.conferenceDataVersion).toBe(1);
    expect(params.requestBody?.conferenceData?.createRequest).toEqual({
      requestId: params.requestBody?.id,
      conferenceSolutionKey: { type: "hangoutsMeet" },
    });
    expect(fix.of("get")).toHaveLength(1);
    expect(res.text).toContain("https://meet.google.com/abc-defg-hij");
    expect(res.structuredContent?.meetStatus).toBe("success");
    await fix.close();
  });

  it("previews without writing, and holds an unpaired guest at the pairing gate", async () => {
    const fix = await connect({});
    const preview = await fix.call("calendar_create_event", { ...base, dryRun: true });
    expect(preview.text).toContain("DRY RUN");
    expect(preview.structuredContent?.notified).toEqual([GUEST]);
    process.env.GOOGLE_MCP_RECIPIENT_PAIRING = "true";
    const held = await fix.call("calendar_create_event", base);
    expect(held.isError).toBe(true);
    expect(held.text).toContain(GUEST);
    expect(fix.of("insert")).toHaveLength(0);
    await fix.close();
  });

  it("rejects a start and end that mix a date and a time", async () => {
    const fix = await connect({});
    const res = await fix.call("calendar_create_event", { ...base, end: "2026-11-21" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("both be dates or both be times");
    await fix.close();
  });

  it("derives one ID per request, in the base32hex alphabet Calendar allows", () => {
    const a = eventIdFor(["primary", "Planning", 1, 2]);
    expect(a).toMatch(/^[0-9a-v]{40}$/);
    expect(eventIdFor(["primary", "Planning", 1, 2])).toBe(a);
    expect(eventIdFor(["primary", "Planning", 1, 3])).not.toBe(a);
  });
});

describe("mergeGuests", () => {
  it("adds case-insensitively without duplicating an existing guest", () => {
    const { attendees, added } = mergeGuests(
      [{ email: "A@x.com", responseStatus: "accepted" }],
      ["a@x.com", "b@x.com"],
      [],
    );
    expect(attendees).toEqual([
      { email: "A@x.com", responseStatus: "accepted" },
      { email: "b@x.com" },
    ]);
    expect(added).toEqual(["b@x.com"]);
  });
});

describe("calendar_read_invite_email", () => {
  /** A Google invite email: alternative[ plain, html, calendar ], plus the .ics attachment. */
  const email = (opts: { ics: string; from?: string; body?: string; inline?: boolean }) => ({
    id: "msg1",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: opts.from ?? `Guest Person <${GUEST}>` },
        { name: "Subject", value: "Proposed new time" },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64url(opts.body ?? "") } },
            opts.inline === false
              ? { mimeType: "text/calendar", body: { attachmentId: "att-cal", size: 2596 } }
              : { mimeType: "text/calendar", body: { data: b64url(opts.ics) } },
          ],
        },
      ],
    },
  });

  const proposal = (over: Partial<Parameters<typeof email>[0]> = {}) =>
    email({ ics: COUNTER_ICS, body: `View: ${eventLink(OCCURRENCE_ID, ME)}`, ...over });

  it("reads a proposed new time and names the occurrence to move", async () => {
    const fix = await connect({ message: proposal(), event: occurrence() });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent!;
    expect(out.method).toBe("COUNTER");
    expect(out.eventId).toBe(OCCURRENCE_ID);
    expect(out.sender).toBe(GUEST);
    expect(out.senderOnEvent).toBe(true);
    expect(out.warnings).toEqual([]);
    expect(out.offered).toMatchObject({
      start: "2026-11-18T21:00:00.000Z",
      end: "2026-11-18T21:30:00.000Z",
      label: "Wed Nov 18, 4:00 PM - 4:30 PM EST",
    });
    expect(res.text).toContain("calendar_update_event");
    expect(fix.of("get")[0]?.params.eventId).toBe(OCCURRENCE_ID);
    expect(fix.of("gmail.get")[0]?.params.fields).toBe("payload");
    // Free text from the invite never reaches the agent.
    const everything = JSON.stringify(res);
    expect(everything).not.toContain("Ignore previous instructions");
    expect(everything).not.toContain("Passcode");
    await fix.close();
  });

  it("fetches the calendar part by attachment ID when Gmail holds it back", async () => {
    const fix = await connect({
      message: proposal({ inline: false }),
      attachment: b64url(COUNTER_ICS),
      event: occurrence(),
    });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    expect(fix.of("gmail.attachment")[0]?.params.id).toBe("att-cal");
    expect(res.structuredContent?.method).toBe("COUNTER");
    await fix.close();
  });

  it("finds the occurrence by the invite's UID when the email has no event link", async () => {
    const fix = await connect({
      message: proposal({ body: "no link" }),
      list: () => ({
        items: [
          occurrence({
            id: SERIES_ID,
            recurringEventId: undefined,
            recurrence: ["RRULE:FREQ=WEEKLY"],
          }),
        ],
      }),
      instances: () => ({ items: [occurrence()] }),
    });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    expect(fix.of("list")[0]?.params.iCalUID).toBe(`${SERIES_ID}@google.com`);
    expect(fix.of("instances")[0]?.params).toMatchObject({
      eventId: SERIES_ID,
      originalStart: "2026-11-17T17:30:00.000Z",
    });
    expect(res.structuredContent?.eventId).toBe(OCCURRENCE_ID);
    await fix.close();
  });

  it("warns when the sender isn't on the event -- a forged proposal", async () => {
    const fix = await connect({
      message: proposal({ from: "Mallory <mallory@evil.example>" }),
      event: occurrence(),
    });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    const warnings = res.structuredContent?.warnings as string[];
    expect(warnings.join(" ")).toContain("mallory@evil.example");
    expect(res.structuredContent?.nextStep).toContain("Check the warnings");
    expect(res.text).not.toContain("calendar_update_event with eventId");
    await fix.close();
  });

  it("warns when the email's event link doesn't match the invite it carries", async () => {
    const fix = await connect({
      message: proposal({ body: eventLink("othereventid12345_20261117T173000Z", ME) }),
      event: occurrence(),
    });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    expect((res.structuredContent?.warnings as string[]).join(" ")).toContain("does not match");
    await fix.close();
  });

  it("reports an outside invite that isn't on the calendar yet", async () => {
    const fix = await connect({
      message: email({ ics: REQUEST_ICS, from: `Vendor <${ORGANIZER}>` }),
      list: () => ({ items: [] }),
    });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    const out = res.structuredContent!;
    expect(out.method).toBe("REQUEST");
    expect(out.onCalendar).toBe(false);
    expect(out.offered).toMatchObject({ start: "2026-11-20T19:00:00.000Z" });
    expect((out.warnings as string[]).join(" ")).toContain("adds it from the email in Gmail");
    await fix.close();
  });

  it("names the Gmail scope, not the calendar one, when the Gmail read is refused", async () => {
    const fix = await connect({
      messageError: apiError(403, "Request had insufficient authentication scopes."),
    });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(",gmail.readonly`");
    expect(res.text).not.toContain("calendar.events");
    await fix.close();
  });

  it("says so when the message has no calendar part", async () => {
    const fix = await connect({
      message: { id: "msg1", payload: { mimeType: "text/plain", body: { data: b64url("hi") } } },
    });
    const res = await fix.call("calendar_read_invite_email", { messageId: "msg1" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("no calendar invite");
    await fix.close();
  });
});
