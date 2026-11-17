/**
 * Minimal iCalendar (RFC 5545) reader for the calendar part of an invite
 * email. It reads one VEVENT and the calendar's METHOD, which is all a
 * Google invite, update, cancellation, or proposed-time notice carries.
 *
 * Pure and dependency-free, so the invite tool's parsing is testable
 * against real fixtures without a Gmail client. Time-zone conversion of
 * `TZID` values lives with the other zone math in `tools/calendar.ts`.
 */

export interface IcsProperty {
  /** Parameters, keys upper-cased: `{ TZID: "America/New_York" }`. */
  params: Record<string, string>;
  value: string;
}

export interface IcsEvent {
  /** `METHOD` of the enclosing VCALENDAR: REQUEST, COUNTER, CANCEL, REPLY... */
  method: string | null;
  /** First VEVENT's properties, keyed by upper-cased name. Repeats (ATTENDEE) keep every entry. */
  props: Map<string, IcsProperty[]>;
}

/**
 * Parse an iCalendar text. Lines are unfolded once, then read in a
 * single pass. Only the first VEVENT is kept; nested components inside
 * it (VALARM) are skipped so their DTSTART/DESCRIPTION can't shadow the
 * event's own.
 */
export function parseIcs(text: string): IcsEvent {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const props = new Map<string, IcsProperty[]>();
  let method: string | null = null;
  let inEvent = false;
  let doneEvent = false;
  let nested = 0;

  for (const line of lines) {
    if (!line) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    const { name } = prop;

    if (name === "BEGIN") {
      if (prop.value.toUpperCase() === "VEVENT" && !doneEvent && !inEvent) inEvent = true;
      else if (inEvent) nested++;
      continue;
    }
    if (name === "END") {
      if (inEvent && nested > 0) nested--;
      else if (inEvent && prop.value.toUpperCase() === "VEVENT") {
        inEvent = false;
        doneEvent = true;
      }
      continue;
    }
    if (name === "METHOD" && !inEvent) {
      method = prop.value.toUpperCase();
      continue;
    }
    if (inEvent && nested === 0) {
      const list = props.get(name) ?? [];
      list.push({ params: prop.params, value: prop.value });
      props.set(name, list);
    }
  }
  return { method, props };
}

/**
 * Split one unfolded content line into name, params, and value. The
 * value starts at the first colon outside a quoted parameter value, so
 * `CN="Doe: Jane"` doesn't truncate the line.
 */
function parseLine(line: string): (IcsProperty & { name: string }) | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon).split(";");
  const name = (head[0] ?? "").toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value: line.slice(colon + 1) };
}

export function firstProp(ev: IcsEvent, name: string): IcsProperty | undefined {
  return ev.props.get(name)?.[0];
}

/** `mailto:a@b.com` → `a@b.com`, lower-cased; null for any other URI. */
export function mailtoAddress(value: string): string | null {
  const m = /^mailto:(.+)$/i.exec(value.trim());
  return m?.[1] ? m[1].trim().toLowerCase() : null;
}

/** The wall-clock fields of an iCalendar DATE or DATE-TIME value. */
export interface IcsDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  allDay: boolean;
  utc: boolean;
  /** Set only for a local time with a `TZID` parameter. */
  tzid: string | null;
}

/**
 * Read a DTSTART / DTEND / RECURRENCE-ID value. Returns null for a shape
 * this reader doesn't handle, such as a floating local time with no
 * TZID, which has no fixed instant.
 */
export function icsDateParts(prop: IcsProperty): IcsDateParts | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  const allDay = m[4] === undefined;
  const utc = m[7] === "Z";
  const tzid = !allDay && !utc ? (prop.params.TZID ?? null) : null;
  if (!allDay && !utc && !tzid) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
    allDay,
    utc,
    tzid,
  };
}

/**
 * Find a Google Calendar event link in an email body and decode its
 * `eid`. The `eid` is base64url of `<eventId> <calendarEmail>`, and for
 * one occurrence of a series the event ID already carries its
 * `_<YYYYMMDDTHHMMSSZ>` suffix. Returns null when no link decodes to
 * that shape.
 */
export function decodeEid(body: string): { eventId: string; calendarId: string } | null {
  for (const m of body.matchAll(/[?&](?:amp;)?eid=([A-Za-z0-9_-]{8,512})/g)) {
    const decoded = Buffer.from(m[1] ?? "", "base64url").toString("utf8");
    const parts = /^([A-Za-z0-9_]{5,1024}) (\S+@\S+)$/.exec(decoded);
    if (parts?.[1] && parts[2]) return { eventId: parts[1], calendarId: parts[2] };
  }
  return null;
}
