/**
 * Streaming ICS Writer
 *
 * Issue #2085 – Switch calendar export to streaming ICS writer for large accounts
 * ---------------------------------------------------------------------------------
 * Problem: The previous calendar export built the entire .ics string in memory
 * before sending it to the client.  For accounts with thousands of subscription
 * events this caused:
 *  - Peak heap spikes of 400–800 MB per export request.
 *  - Request timeouts for accounts with > 5 000 events (> 30 s to build string).
 *  - No ability to pipe the response incrementally, forcing users to wait for the
 *    full payload before the browser's download dialog appeared.
 *
 * Solution: `IcsStreamWriter` wraps a Node.js `Writable` / `PassThrough` stream.
 *  - Callers call `writeEvent()` for each CalendarEvent (or `writeRawEvent()` for
 *    pre-serialised VEVENT blocks) one at a time, keeping memory usage flat at
 *    O(1) per event regardless of account size.
 *  - `beginCalendar()` / `endCalendar()` emit the VCALENDAR wrapper lines.
 *  - `pipeToResponse()` wires the stream directly into an Express `Response` or
 *    any Node `Writable`, so the first bytes reach the client in milliseconds.
 *  - Long property values are automatically folded at 75 octets per RFC 5545 §3.1.
 *
 * Usage (Express handler):
 * ```ts
 * import { IcsStreamWriter } from '../calendar/domain/IcsStreamWriter';
 *
 * router.get('/export/calendar/:userId', async (req, res) => {
 *   res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
 *   res.setHeader('Content-Disposition', 'attachment; filename="subscriptions.ics"');
 *
 *   const writer = new IcsStreamWriter();
 *   writer.pipeToResponse(res);
 *   writer.beginCalendar({ prodId: '-//SubTrackr//EN', calName: 'Subscriptions' });
 *
 *   for await (const event of db.streamCalendarEvents(req.params.userId)) {
 *     writer.writeEvent(event);
 *   }
 *
 *   writer.endCalendar();
 * });
 * ```
 */

import { PassThrough, Writable } from 'stream';
import type { CalendarEvent, CalendarEventType } from './types';
import { EVENT_TYPE_LABELS } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IcsCalendarOptions {
  /** PRODID property value. Default: `-//SubTrackr//SubTrackr Calendar//EN` */
  prodId?: string;
  /** X-WR-CALNAME – display name shown in calendar apps. */
  calName?: string;
  /** X-WR-TIMEZONE – IANA timezone string. Default: `UTC` */
  timezone?: string;
  /** X-WR-CALDESC – calendar description. */
  description?: string;
}

export interface IcsEventOptions {
  /**
   * Optional VALARM block: number of minutes before the event to alert.
   * Pass `[]` or omit to suppress alarms.
   */
  alarmMinutesBefore?: number[];
  /** Optional URL property attached to the VEVENT. */
  url?: string;
  /** CATEGORIES property value. Auto-derived from eventType if omitted. */
  categories?: string;
}

export interface IcsWriterMetrics {
  eventsWritten: number;
  bytesWritten: number;
  foldedLines: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum line length (octets) before folding, per RFC 5545 §3.1. */
const MAX_LINE_OCTETS = 75;

/** ICS line ending (CRLF per RFC 5545). */
const CRLF = '\r\n';

// ─── IcsStreamWriter ─────────────────────────────────────────────────────────

export class IcsStreamWriter {
  private readonly stream: PassThrough;
  private metrics: IcsWriterMetrics = {
    eventsWritten: 0,
    bytesWritten: 0,
    foldedLines: 0,
  };
  private calendarOpen = false;

  constructor() {
    this.stream = new PassThrough({ encoding: 'utf8' });
  }

  // ─── Pipe ──────────────────────────────────────────────────────────────────

  /**
   * Pipes the ICS stream into any Node `Writable` (Express `res`, file stream,
   * S3 upload stream, etc.).  Call this before `beginCalendar()`.
   */
  pipeToResponse(destination: Writable): void {
    this.stream.pipe(destination);
  }

  /**
   * Returns the underlying PassThrough stream for manual piping or testing.
   */
  getStream(): PassThrough {
    return this.stream;
  }

  // ─── Calendar envelope ─────────────────────────────────────────────────────

  beginCalendar(options: IcsCalendarOptions = {}): void {
    if (this.calendarOpen) throw new Error('Calendar already open');
    this.calendarOpen = true;

    const {
      prodId = '-//SubTrackr//SubTrackr Calendar//EN',
      calName,
      timezone = 'UTC',
      description,
    } = options;

    this.writeLine('BEGIN:VCALENDAR');
    this.writeLine('VERSION:2.0');
    this.writeLine(`PRODID:${prodId}`);
    this.writeLine('CALSCALE:GREGORIAN');
    this.writeLine('METHOD:PUBLISH');

    if (calName) this.writeProperty('X-WR-CALNAME', calName);
    this.writeLine(`X-WR-TIMEZONE:${timezone}`);
    if (description) this.writeProperty('X-WR-CALDESC', description);
  }

  endCalendar(): void {
    if (!this.calendarOpen) throw new Error('Calendar not open');
    this.writeLine('END:VCALENDAR');
    this.stream.end();
    this.calendarOpen = false;
  }

  // ─── Event serialisation ───────────────────────────────────────────────────

  /**
   * Serialises a `CalendarEvent` domain object into a VEVENT block and writes
   * it to the stream.  Memory cost: O(1) – the event is serialised directly to
   * the stream without accumulation.
   */
  writeEvent(event: CalendarEvent, options: IcsEventOptions = {}): void {
    const { alarmMinutesBefore = [], url, categories } = options;
    const eventLabel = EVENT_TYPE_LABELS[event.eventType as CalendarEventType] ?? event.eventType;

    this.writeLine('BEGIN:VEVENT');
    this.writeProperty('UID', `${event.id}@subtrackr`);
    this.writeProperty('SUMMARY', event.title);
    this.writeProperty('DESCRIPTION', event.description);
    this.writeLine(`DTSTAMP:${toIcsDate(new Date())}`);
    this.writeLine(`DTSTART:${toIcsDateTime(event.startTime)}`);
    this.writeLine(`DTEND:${toIcsDateTime(event.endTime)}`);
    this.writeLine(`STATUS:${event.syncStatus === 'synced' ? 'CONFIRMED' : 'TENTATIVE'}`);
    this.writeProperty('CATEGORIES', categories ?? eventLabel);
    this.writeLine(`LAST-MODIFIED:${toIcsDateTime(event.localUpdatedAt)}`);

    if (url) this.writeProperty('URL', url);

    // VALARM blocks – one per requested lead time
    for (const mins of alarmMinutesBefore) {
      this.writeLine('BEGIN:VALARM');
      this.writeLine('ACTION:DISPLAY');
      this.writeProperty('DESCRIPTION', event.title);
      this.writeLine(`TRIGGER:-PT${mins}M`);
      this.writeLine('END:VALARM');
    }

    this.writeLine('END:VEVENT');
    this.metrics.eventsWritten++;
  }

  /**
   * Writes a pre-serialised VEVENT block verbatim (for migration / passthrough
   * scenarios where events are already in ICS format).
   * Lines are re-folded if they exceed the 75-octet limit.
   */
  writeRawEvent(veventBlock: string): void {
    for (const line of veventBlock.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      this.writeLine(line);
    }
    this.metrics.eventsWritten++;
  }

  // ─── Metrics ──────────────────────────────────────────────────────────────

  getMetrics(): Readonly<IcsWriterMetrics> {
    return { ...this.metrics };
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Writes a single (possibly folded) property line followed by CRLF.
   * Property values are escaped and folded per RFC 5545 §3.1 and §3.3.11.
   */
  private writeProperty(name: string, value: string): void {
    const escaped = escapeIcsValue(value);
    this.writeLine(`${name}:${escaped}`);
  }

  /**
   * Folds the line at MAX_LINE_OCTETS octets (RFC 5545 §3.1) and writes each
   * segment followed by CRLF.  Continuation lines are prefixed with a single
   * space character.
   */
  private writeLine(line: string): void {
    const chunks = foldLine(line);
    if (chunks.length > 1) this.metrics.foldedLines += chunks.length - 1;
    const output = chunks.join(`${CRLF} `);
    const bytes = Buffer.byteLength(output + CRLF, 'utf8');
    this.stream.write(output + CRLF);
    this.metrics.bytesWritten += bytes;
  }
}

// ─── RFC 5545 helpers ────────────────────────────────────────────────────────

/**
 * Folds a content line into 75-octet segments per RFC 5545 §3.1.
 * Folding splits on octet boundaries, not character boundaries, to handle
 * multi-byte UTF-8 sequences correctly.
 */
export function foldLine(line: string): string[] {
  const encoded = Buffer.from(line, 'utf8');
  if (encoded.length <= MAX_LINE_OCTETS) return [line];

  const result: string[] = [];
  let offset = 0;

  // First chunk: MAX_LINE_OCTETS octets
  // Subsequent chunks: MAX_LINE_OCTETS - 1 octets (1 octet used for the leading space)
  let chunkSize = MAX_LINE_OCTETS;
  while (offset < encoded.length) {
    // Avoid splitting a multi-byte UTF-8 sequence: walk back until we're on a
    // sequence boundary (high byte of a continuation octet starts with 0b10xx_xxxx).
    let end = Math.min(offset + chunkSize, encoded.length);
    while (end < encoded.length && (encoded[end] & 0xc0) === 0x80) end--;
    result.push(encoded.slice(offset, end).toString('utf8'));
    offset = end;
    chunkSize = MAX_LINE_OCTETS - 1; // reserve 1 octet for the folding space
  }
  return result;
}

/**
 * Escapes special characters in ICS text values per RFC 5545 §3.3.11.
 */
export function escapeIcsValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Formats a Date as a UTC DATE-TIME string: `YYYYMMDDTHHmmssZ`.
 */
export function toIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Parses an ISO-8601 string and formats it as an ICS DATE-TIME.
 */
export function toIcsDateTime(isoString: string): string {
  return toIcsDate(new Date(isoString));
}
