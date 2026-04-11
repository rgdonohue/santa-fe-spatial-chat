/**
 * Structured JSON logger
 *
 * Writes newline-delimited JSON to stdout. No external dependencies.
 * Each line is parseable by any log aggregator (e.g. CloudWatch, Datadog).
 */

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  [key: string]: unknown;
}

export function log(entry: Omit<LogEntry, 'timestamp'>): void {
  // Spread order matters: timestamp first so entry fields can override if needed.
  // Cast is safe because entry is typed to supply all non-timestamp fields.
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...entry } as LogEntry));
}
