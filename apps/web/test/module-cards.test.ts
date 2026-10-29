import { describe, expect, it } from 'vitest';
import type { PublicUser } from '@universe/contracts';
import hub from '../src/modules/hub/module';
import wellbeing from '../src/modules/wellbeing/module';

const user = { id: '00000000-0000-4000-8000-000000000000' } as PublicUser;

describe('hub card and inbox text (P4 contract)', () => {
  it('shows the design’s copy per role', () => {
    expect(
      hub.dashboardCard?.(
        {
          kind: 'student',
          dsa: { solved: 118, total: 190, percent: 62 },
          newResources: { count: 4, topSubject: 'OS' },
          goal: { done: 14, target: 20 },
          status: 'on_track',
        },
        user,
      ),
    ).toEqual({
      big: '62%',
      text: 'DSA sheet, 118 of 190. 4 new resources in OS.',
      status: 'ON TRACK',
      tone: 'ok',
    });
    expect(
      hub.dashboardCard?.(
        { kind: 'mentor', pendingRequests: 2, menteesThisTerm: 6, nextSessionAt: null },
        user,
      ),
    ).toEqual({ big: '2', text: 'Mentorship requests waiting. 6 mentees this term.' });
    expect(hub.dashboardCard?.({ status: 'not_built' }, user)).toBeNull();
  });

  it('words hub events after the actor’s name', () => {
    const format = hub.activityText?.['hub.request_received'];
    expect(
      format?.(
        { requestId: user.id, studentName: 'Diya', note: 'interval DP.', startsAt: null },
        {} as never,
      ),
    ).toBe('requested mentorship: interval DP.');
  });
});

describe('wellbeing card and inbox text (P5 contract)', () => {
  it('shows today, the comparison and the tracking state', () => {
    expect(
      wellbeing.dashboardCard?.(
        { todayMinutes: 212, percentVsAverage: 20, direction: 'under', tracking: 'paused' },
        user,
      ),
    ).toEqual({
      big: '3h 32m',
      text: 'Screen time today, 20% under your average.',
      status: 'PAUSED',
      tone: 'warn',
    });
    expect(wellbeing.dashboardCard?.({ todayMinutes: 0, tracking: 'off' }, user)).toMatchObject({
      big: '—',
      text: 'No data stored.',
    });
    expect(
      wellbeing.activityText?.['wellbeing.weekly_summary']?.(
        { message: 'Your weekly summary is ready. Only you can see it.' },
        {} as never,
      ),
    ).toBe('Your weekly summary is ready. Only you can see it.');
  });
});
