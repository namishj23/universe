import type { z } from 'zod';
import { activityRegistry, HubDashboardSummary, type ActivityType } from '@universe/contracts';
import type { CardContent, WebModule } from '../../shell/modules';
import { weekdayTime } from '../../shell/format';

type Payloads = { [T in ActivityType as T extends `hub.${string}` ? T : never]: T };
type Text = { [T in keyof Payloads]: (p: z.infer<(typeof activityRegistry)[T]>) => string };

/** Plain text after the actor's name (the inbox renders it as text, never HTML). */
const text: Text = {
  'hub.request_received': (p) => `requested mentorship${p.note ? `: ${p.note}` : '.'}`,
  'hub.request_accepted': (p) => `accepted your mentorship request for ${weekdayTime(p.startsAt)}.`,
  'hub.request_declined': () => 'declined your mentorship request.',
  'hub.request_cancelled': (p) =>
    p.startsAt
      ? `cancelled the mentorship session on ${weekdayTime(p.startsAt)}.`
      : 'cancelled the mentorship request.',
};

// Each formatter only sees a payload its contract accepts; anything else falls back.
const activityText = Object.fromEntries(
  Object.entries(text).map(([type, format]) => [
    type,
    (payload: unknown) =>
      (format as (p: unknown) => string)(activityRegistry[type as keyof Payloads].parse(payload)),
  ]),
);

/** The design's copy per role (student, mentor, admin). */
function dashboardCard(data: unknown): CardContent | null {
  const parsed = HubDashboardSummary.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.kind === 'mentor')
    return {
      big: String(d.pendingRequests),
      text: `Mentorship requests waiting. ${d.menteesThisTerm} mentees this term.`,
    };
  if (d.kind === 'admin')
    return { big: String(d.resourcesTotal), text: 'Resources in the shared repository.' };
  const resources = d.newResources.topSubject
    ? ` ${d.newResources.count} new resources in ${d.newResources.topSubject}.`
    : '';
  return {
    big: `${d.dsa.percent}%`,
    text: `DSA sheet, ${d.dsa.solved} of ${d.dsa.total}.${resources}`,
    status: d.status === 'on_track' ? 'ON TRACK' : 'BEHIND',
    tone: d.status === 'on_track' ? 'ok' : 'warn',
  };
}

/** Any request decision changes mentors, requests and slots: refetch the hub's queries. */
const invalidates = Object.fromEntries(Object.keys(text).map((type) => [type, [['hub']]]));

const hub: WebModule = { activityText, dashboardCard, invalidates };
export default hub;
