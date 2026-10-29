import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import {
  DashboardResponse,
  WeekResponse,
  type DashboardModuleEntry,
  type ModuleInfo,
  type PublicUser,
  type WeekItem,
} from '@universe/contracts';
import { api } from '../../platform/api';
import { useUser } from '../../platform/auth';
import { useActivity, useFeed } from '../activity/ActivityProvider';
import { activityLine } from '../activity/text';
import { dayLabel, dayMonthLabel, localDate, partOfDay, shortName, shortWhen } from '../format';
import { useModules } from '../layout/AppShell';
import { AREA, webModules, type CardContent } from '../modules';
import { cx } from '../ui/cx';
import { CodeTile, HeaderMeta, PageHeader, toneClass } from '../ui/Page';
import { Empty, ErrorBox, Loading } from '../ui/States';
import s from './Dashboard.module.css';

export const DASHBOARD_KEY = ['dashboard'] as const;
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function greeting(user: PublicUser, now: Date) {
  const day = `${dayLabel(localDate(now))} ${dayMonthLabel(localDate(now)).slice(3)}`;
  const hello =
    user.role === 'admin' ? user.name.toUpperCase() : `${partOfDay(now)}, ${shortName(user.name)}`;
  return `${hello} · ${day}`;
}

function WeekStrip({ week, today }: { week: WeekResponse; today: string }) {
  return (
    <div className={s.weekScroll}>
      <ol className={s.week} aria-label="Your week">
        {week.days.map((day) => {
          const isToday = day.date === today;
          return (
            <li key={day.date} className={cx(s.day, isToday && s.today)}>
              <span className={s.dayLabel}>
                {dayLabel(day.date)}
                {isToday && ' · TODAY'}
              </span>
              {day.items.map((it, i) => (
                <WeekEntry key={`${it.href}-${i}`} item={it} />
              ))}
              {day.items.length === 0 && <span className={s.nothing}>Nothing yet</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function WeekEntry({ item }: { item: WeekItem }) {
  const when = 'time' in item ? item.time : 'all day';
  return (
    <Link to={item.href} className={cx(s.item, !item.confirmed && s.dashed)} data-mod={item.module}>
      <span className={s.meta}>
        {AREA[item.module].code} · {when}
      </span>
      <span className={s.itemTitle}>{item.title}</span>
      <span className={cx(s.status, toneClass(item.status?.tone ?? 'neutral'))}>
        {item.status && `● ${item.status.label}`}
      </span>
    </Link>
  );
}

const PLACEHOLDER: CardContent = { big: '—', text: 'Coming in the next build.' };

function ModuleCard({
  module,
  entry,
  user,
  onRetry,
}: {
  module: ModuleInfo;
  entry: DashboardModuleEntry | undefined;
  user: PublicUser;
  onRetry: () => void;
}) {
  const failed = entry && entry.status !== 'ok';
  const content: CardContent = failed
    ? { big: '—', text: '', status: "Couldn't load · retry", tone: 'err' }
    : ((entry && webModules[module.id]?.dashboardCard?.(entry.data, user)) ?? PLACEHOLDER);
  const inner = (
    <>
      <div className={s.cardHead}>
        <span className={s.cardLabel}>{module.label}</span>
        <CodeTile module={module.id} code={AREA[module.id].code} />
      </div>
      <div className={s.cardBody}>
        <span className={s.big}>{content.big}</span>
        <span className={s.cardText}>{content.text}</span>
        <span className={cx(s.cardStatus, toneClass(content.tone ?? 'neutral'))}>
          {content.status}
        </span>
      </div>
    </>
  );
  // A failed summary never fails the page: its card retries instead of opening the module.
  return failed ? (
    <button
      type="button"
      className={s.card}
      onClick={onRetry}
      aria-label={`${module.label}: couldn't load, retry`}
    >
      {inner}
    </button>
  ) : (
    <Link to={`/${module.id}`} className={s.card}>
      {inner}
    </Link>
  );
}

export function DashboardPage() {
  const user = useUser();
  const navigate = useNavigate();
  const now = new Date();
  const today = localDate(now);
  const modules = useModules();
  const feed = useFeed();
  const { unread } = useActivity();
  const dashboard = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: ({ signal }) => api('/api/dashboard', DashboardResponse, { signal }),
  });
  const week = useQuery({
    queryKey: [...DASHBOARD_KEY, 'week', today],
    queryFn: ({ signal }) =>
      api('/api/dashboard/week', WeekResponse, { signal, headers: { 'X-Timezone': timeZone() } }),
  });
  const retry = () => {
    void dashboard.refetch();
    void week.refetch();
  };

  const header = (
    <PageHeader
      eyebrow={greeting(user, now)}
      title="Your week"
      baseline
      action={
        <HeaderMeta>
          {dayMonthLabel(today)} – {dayMonthLabel(addDays(today, 6))}
        </HeaderMeta>
      }
    />
  );

  if (dashboard.isPending || week.isPending || modules.isPending)
    return (
      <>
        {header}
        <Loading what="your dashboard" />
      </>
    );
  const error = dashboard.error ?? week.error ?? modules.error;
  if (error || !dashboard.data || !week.data || !modules.data)
    return (
      <>
        {header}
        <ErrorBox error={error} what="your dashboard" onRetry={retry} />
      </>
    );

  const events = feed.data?.pages[0]?.items ?? [];
  const entries = new Map(dashboard.data.modules.map((m) => [m.id, m]));
  const nothing =
    week.data.days.every((d) => d.items.length === 0) &&
    dashboard.data.modules.length === 0 &&
    events.length === 0;
  if (nothing) {
    const rides = modules.data.some((m) => m.id === 'rides');
    return (
      <>
        {header}
        <Empty
          title="Nothing on your week yet"
          body="Rides, mentor sessions and goals show up here as soon as you add them."
          action={
            rides ? { label: 'Find a ride', onClick: () => void navigate('/rides') } : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <WeekStrip week={week.data} today={today} />
      <div className={s.cards}>
        {modules.data.map((m) => (
          <ModuleCard key={m.id} module={m} entry={entries.get(m.id)} user={user} onRetry={retry} />
        ))}
      </div>
      <section className={s.inbox} aria-label="Inbox">
        <div className={s.inboxHead}>
          <span className={s.inboxLabel}>INBOX · {unread} NEW</span>
          <Link to="/inbox" className={s.inboxLink}>
            Open inbox
          </Link>
        </div>
        {events.slice(0, 3).map((e) => {
          const line = activityLine(e, user);
          return (
            <div key={e.id} className={s.preview} data-mod={e.module}>
              <span className={s.time}>{shortWhen(e.createdAt, now)}</span>
              <span className={s.code}>{AREA[e.module].code}</span>
              <span>
                {line.who && <b>{line.who}</b>}
                {line.who && ' '}
                {line.text}
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}
