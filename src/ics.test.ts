import { describe, it, expect } from "vitest";
import { decodeEid, firstProp, icsDateParts, mailtoAddress, parseIcs } from "./ics.js";
import { icsTime } from "./tools/calendar.js";
import {
  COUNTER_ICS,
  GUEST,
  OCCURRENCE_ID,
  ORGANIZER,
  REQUEST_ICS,
  SERIES_ID,
  eventLink,
} from "./test-fixtures/invites.js";

describe("parseIcs", () => {
  const ev = parseIcs(COUNTER_ICS);

  it("reads the calendar's METHOD", () => {
    expect(ev.method).toBe("COUNTER");
  });

  it("keeps the VEVENT's own DTSTART, not the VTIMEZONE's", () => {
    expect(firstProp(ev, "DTSTART")?.value).toBe("20261118T210000Z");
    expect(ev.props.get("DTSTART")).toHaveLength(1);
  });

  it("unfolds a continued line before reading it", () => {
    const att = firstProp(ev, "ATTENDEE");
    expect(att?.params.CN).toBe("Guest Person");
    expect(mailtoAddress(att?.value ?? "")).toBe(GUEST);
  });

  it("skips a nested VALARM so its DESCRIPTION can't shadow the event's", () => {
    expect(ev.props.get("DESCRIPTION")).toHaveLength(1);
    expect(firstProp(ev, "DESCRIPTION")?.value).toContain("Join Zoom Meeting");
    expect(firstProp(ev, "TRIGGER")).toBeUndefined();
  });

  it("keeps parameters, including a TZID on RECURRENCE-ID", () => {
    const rid = firstProp(ev, "RECURRENCE-ID");
    expect(rid?.params.TZID).toBe("America/Los_Angeles");
    expect(rid?.value).toBe("20261117T093000");
  });

  it("does not split a value on a colon inside a quoted parameter", () => {
    const org = firstProp(parseIcs(REQUEST_ICS), "ORGANIZER");
    expect(org?.params.CN).toBe("Vendor: Team");
    expect(mailtoAddress(org?.value ?? "")).toBe(ORGANIZER);
  });

  it("returns an empty event for text that isn't iCalendar", () => {
    const empty = parseIcs("hello\r\nworld");
    expect(empty.method).toBeNull();
    expect(empty.props.size).toBe(0);
  });
});

describe("icsDateParts / icsTime", () => {
  it("reads a UTC time as given", () => {
    expect(icsTime({ params: {}, value: "20261118T210000Z" })).toEqual({
      iso: "2026-11-18T21:00:00.000Z",
      allDay: false,
    });
  });

  it("converts a TZID time with the zone's own offset", () => {
    // 09:30 in Los Angeles on Nov 17 (PST, UTC-8) is 17:30Z -- the
    // suffix of the occurrence ID Google uses for that meeting.
    expect(
      icsTime({ params: { TZID: "America/Los_Angeles" }, value: "20261117T093000" })?.iso,
    ).toBe("2026-11-17T17:30:00.000Z");
    expect(OCCURRENCE_ID.endsWith("20261117T173000Z")).toBe(true);
  });

  it("reads a date as all-day", () => {
    expect(icsTime({ params: { VALUE: "DATE" }, value: "20261118" })).toEqual({
      iso: "2026-11-18",
      allDay: true,
    });
  });

  it("refuses a floating time with no zone, and an unknown zone", () => {
    expect(icsDateParts({ params: {}, value: "20261118T090000" })).toBeNull();
    expect(icsTime({ params: { TZID: "Not/AZone" }, value: "20261118T090000" })).toBeNull();
  });
});

describe("decodeEid", () => {
  it("decodes the occurrence ID and calendar from a Google event link", () => {
    const body = `View all guest info ${eventLink(OCCURRENCE_ID, ORGANIZER)}`;
    expect(decodeEid(body)).toEqual({ eventId: OCCURRENCE_ID, calendarId: ORGANIZER });
  });

  it("reads an HTML-escaped link", () => {
    const html = `<a href="${eventLink(SERIES_ID, ORGANIZER).replace("&eid", "&amp;eid")}">`;
    expect(decodeEid(html)?.eventId).toBe(SERIES_ID);
  });

  it("skips an eid that doesn't decode to an event ID and a calendar", () => {
    const junk = Buffer.from("not an event", "utf8").toString("base64url");
    expect(decodeEid(`?eid=${junk}`)).toBeNull();
    expect(decodeEid("no links here")).toBeNull();
  });
});
