import type { hub } from '@universe/contracts';
import { clock } from '../../shell/format';

/** SCREEN_TEXT.hub.what: "Couldn't load the Student Hub." / "LOADING THE STUDENT HUB…". */
export const HUB_WHAT = 'the Student Hub';

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

/** `Mon 15:30` */
export const weekdayShortTime = (at: string) => `${weekday.format(new Date(at))} ${clock(at)}`;

/** `Mon 02 Nov · 15:30–16:30 · SPIT Main Gate` */
export function slotLabel(slot: Pick<hub.Slot, 'startsAt' | 'endsAt' | 'locationLabel'>) {
  const d = new Date(slot.startsAt);
  const when = `${weekday.format(d)} ${dayMonth.format(d)} · ${clock(d)}–${clock(slot.endsAt)}`;
  return slot.locationLabel ? `${when} · ${slot.locationLabel}` : when;
}

/** `28 Oct` */
export const addedLabel = (at: string) => dayMonth.format(new Date(at));

/** The design's short branch names ("TE Comp", "SE IT"); anything else is shown as stored. */
const BRANCH_SHORT: Record<string, string> = {
  'Computer Engineering': 'Comp',
  'Information Technology': 'IT',
  'Electronics and Telecommunication': 'EXTC',
};
export const yearBranch = (c: Pick<hub.StudentCard, 'year' | 'branch'>) =>
  [c.year, c.branch && (BRANCH_SHORT[c.branch] ?? c.branch)].filter(Boolean).join(' ');

/** `2.4 MB`, `640 KB` */
export function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `application/pdf` → `PDF` */
export const fileType = (mime: string) =>
  ({ 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPEG' })[mime] ??
  mime.split('/')[1]?.toUpperCase() ??
  mime;
