import { activityRegistry, WellbeingDashboardSummary } from '@universe/contracts';
import type { CardContent, WebModule } from '../../shell/modules';

const hoursMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

const activityText = {
  // A capitalised sentence: shown on its own ("Your weekly summary is ready. …").
  'wellbeing.weekly_summary': (payload: unknown) =>
    activityRegistry['wellbeing.weekly_summary'].parse(payload).message,
};

/** Only the owner ever sees it: today's total, the comparison and the tracking state. */
function dashboardCard(data: unknown): CardContent | null {
  const parsed = WellbeingDashboardSummary.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.tracking === 'off' && d.todayMinutes === 0)
    return { big: '—', text: 'No data stored.', status: 'OFF', tone: 'neutral' };
  const comparison =
    d.percentVsAverage !== undefined && d.direction
      ? `, ${d.percentVsAverage}% ${d.direction} your average.`
      : '.';
  return {
    big: hoursMinutes(d.todayMinutes),
    text: `Screen time today${comparison}`,
    status: d.tracking === 'paused' ? 'PAUSED' : d.tracking === 'on' ? 'COLLECTING' : 'OFF',
    tone: d.tracking === 'paused' ? 'warn' : d.tracking === 'on' ? 'ok' : 'neutral',
  };
}

const wellbeing: WebModule = { activityText, dashboardCard };
export default wellbeing;
