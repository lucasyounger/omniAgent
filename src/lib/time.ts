/**
 * Time utilities for OmniAgent.
 *
 * Convention:
 * - All internal storage (database, JSON files) uses UTC ISO strings (toISOString()).
 * - All user-facing display (docs, channel replies, logs) uses CST (UTC+8) formatted as `YYYY-MM-DD HH:mm`.
 * - User input times are interpreted as CST and normalized to UTC before storage.
 */
export const CST_OFFSET_HOURS = 8;
export const CST_OFFSET_MS = CST_OFFSET_HOURS * 60 * 60 * 1000;

export function nowUtc(): string {
  return new Date().toISOString();
}

export function nowCst(): Date {
  return new Date(Date.now() + CST_OFFSET_MS);
}

export function utcToCst(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Date(d.getTime() + CST_OFFSET_MS);
}

export function cstToUtc(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Date(d.getTime() - CST_OFFSET_MS);
}

export function formatCstDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : value.toISOString();
  }
  const cstDate = utcToCst(date);
  const yyyy = cstDate.getUTCFullYear();
  const mm = String(cstDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(cstDate.getUTCDate()).padStart(2, '0');
  const hh = String(cstDate.getUTCHours()).padStart(2, '0');
  const min = String(cstDate.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function formatCstTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatCstDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : value.toISOString();
  }
  const cstDate = utcToCst(date);
  const yyyy = cstDate.getUTCFullYear();
  const mm = String(cstDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(cstDate.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseCstDateTime(cstString: string): Date | undefined {
  const match = cstString.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const [, year, month, day, hours, minutes] = match;
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours) - CST_OFFSET_HOURS, Number(minutes), 0, 0),
  );
}

export function parseCstDailyTime(cstString: string): { hours: number; minutes: number } | undefined {
  const match = cstString.match(/(?:daily|every day|每天|每日).*?(\d{1,2}):(\d{2})/i);
  if (!match) return undefined;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function cstDailyToUtc(cstHours: number, cstMinutes: number): { hours: number; minutes: number } {
  const totalMinutes = cstHours * 60 + cstMinutes - CST_OFFSET_HOURS * 60;
  const utcMinutes = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return { hours: Math.floor(utcMinutes / 60), minutes: utcMinutes % 60 };
}

export function utcDailyToCst(utcHours: number, utcMinutes: number): { hours: number; minutes: number } {
  const totalMinutes = utcHours * 60 + utcMinutes + CST_OFFSET_HOURS * 60;
  const cstMinutes = totalMinutes % (24 * 60);
  return { hours: Math.floor(cstMinutes / 60), minutes: cstMinutes % 60 };
}
