import { ApiRequestError } from '../../platform/api';
import { clock } from '../../shell/format';

/** `1.2 km` from metres. */
export const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
/** `₹41` from paise (Indian digit grouping). */
export const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
/** `FRI 30 · 08:10` */
export const dayTime = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit' })
    .format(d)
    .toUpperCase();
  return `${day} · ${clock(d)}`;
};
/** `Fri 30 Oct` */
export const dayMonth = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
    .format(d)
    .replace(',', '');
/** `n seat(s) left` (the API gives seats left, not the car's total). */
export const seatsLeft = (n: number) => `${n} ${n === 1 ? 'seat' : 'seats'} left`;
/** The server's own sentence for a failed mutation (409, 403…), never a generic one. */
export const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Couldn't reach UniVerse. Try again.";
