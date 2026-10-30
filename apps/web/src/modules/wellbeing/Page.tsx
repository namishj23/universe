import { useState, type CSSProperties } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { CATEGORIES, pauseSession } from '@universe/wellbeing-core';
import type { wellbeing as W } from '@universe/contracts';
import { useUser } from '../../platform/auth';
import { AREA } from '../../shell/modules';
import { clock } from '../../shell/format';
import { Button } from '../../shell/ui/Button';
import { cx } from '../../shell/ui/cx';
import { Drawer, Modal, ModalActions } from '../../shell/ui/Overlay';
import { PageHeader } from '../../shell/ui/Page';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { LoadMore } from '../../shell/ui/Table';
import { useToast } from '../../shell/ui/Toast';
import { BarChart, Card, CardLabel, ProgressBar, Switch } from '../../shell/ui/Widgets';
import {
  deleteEverything,
  exportData,
  KEY,
  recordsPage,
  refresh,
  setTracking,
  settingsQuery,
  summaryQuery,
  updateSettings,
} from './api';
import { DeviceCards } from './DeviceCards';
import { useDevice, type Device } from './device';
import { fmtMin, LABEL, message } from './format';
import s from './Wellbeing.module.css';

const WHAT = 'your wellbeing data';
/** The prototype's category value: `1h 35m`, `52m`. */
const catValue = (m: number) => (m < 60 ? `${String(m).padStart(2, '0')}m` : fmtMin(m));
const dayLetter = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
const dayMonth = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );

type Status = Pick<W.Summary, 'tracking' | 'pausedSince'> & { recordCount?: number };

function statusOf(status: Status | undefined, loading: boolean) {
  if (!status)
    return {
      tone: 'muted',
      text: loading ? 'Checking tracking…' : 'Tracking status unavailable',
    } as const;
  if (status.tracking === 'on') return { tone: 'ok', text: 'Collecting daily totals' } as const;
  if (status.tracking === 'paused')
    return {
      tone: 'warn',
      text: `Paused since ${status.pausedSince ? clock(status.pausedSince) : '—'} · nothing is being counted`,
    } as const;
  return {
    tone: 'muted',
    text: status.recordCount
      ? 'Tracking off · nothing is being counted'
      : 'Nothing stored · tracking off',
  } as const;
}

/** Keeps the cached summary and settings in step with a tracking change. */
function applySettings(queryClient: QueryClient, next: W.Settings) {
  queryClient.setQueryData(settingsQuery.queryKey, next);
  queryClient.setQueryData(summaryQuery.queryKey, (old) =>
    old ? { ...old, tracking: next.tracking, pausedSince: next.pausedSince } : old,
  );
}

function PrivacyBar({
  status,
  loading,
  device,
  onSeeData,
  onDelete,
}: {
  status: Status | undefined;
  loading: boolean;
  device: Device;
  onSeeData: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const collecting = status?.tracking === 'on';
  const tracking = useMutation({
    mutationFn: setTracking,
    onSuccess: async (next) => {
      applySettings(queryClient, next);
      // "Pause" also stops recording on this device.
      const current = device.data.current;
      if (next.tracking !== 'on' && current) {
        const paused = pauseSession(current, new Date());
        if (paused.ok) await device.update({ current: paused.session });
      }
      toast(
        next.tracking === 'on' ? 'Tracking resumed.' : 'Tracking paused. Nothing new is counted.',
      );
      void refresh(queryClient);
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const exporting = useMutation({
    mutationFn: exportData,
    onSuccess: ({ doc, name }) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${name} · ${doc.recordCount} records`);
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const { tone, text } = statusOf(status, loading);
  return (
    <div className={s.bar} role="region" aria-label="Privacy controls">
      <span className={s.status} role="status">
        <span
          className={cx(s.dot, tone === 'ok' && s.dotOk, tone === 'warn' && s.dotWarn)}
          aria-hidden="true"
        />
        {text}
      </span>
      <div className={s.actions}>
        <Button
          className={s.btn}
          disabled={!status || tracking.isPending}
          onClick={() => tracking.mutate(collecting ? 'paused' : 'on')}
        >
          {collecting ? 'Pause tracking' : 'Resume tracking'}
        </Button>
        <Button variant="secondary" className={s.btn} onClick={onSeeData}>
          See my data
        </Button>
        <Button
          variant="secondary"
          className={s.btn}
          disabled={exporting.isPending}
          onClick={() => exporting.mutate()}
        >
          Export JSON
        </Button>
        <Button variant="destructive" className={s.btn} onClick={onDelete}>
          Delete everything
        </Button>
      </div>
    </div>
  );
}

function DataDrawer({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  device: Device;
}) {
  const toast = useToast();
  const records = useInfiniteQuery({
    queryKey: [...KEY, 'records'],
    queryFn: ({ pageParam, signal }) => recordsPage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: open,
    gcTime: 0,
    staleTime: 0,
  });
  const rows = records.data?.pages.flatMap((p) => p.items) ?? [];
  const total = records.data?.pages[0]?.total;
  const { events, sessions } = device.data;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Your stored data"
      description={
        total === undefined
          ? 'Exactly what the server holds for you. Nothing else.'
          : `Exactly what the server holds for you: ${total} records. Nothing else.`
      }
    >
      {records.isPending ? (
        <Loading what="your stored data" />
      ) : records.isError ? (
        <ErrorBox
          error={records.error}
          what="your stored data"
          onRetry={() => void records.refetch()}
        />
      ) : (
        <>
          <div
            className={s.table}
            role="table"
            aria-label="Stored daily totals"
            style={{ '--cols': '90px minmax(0,1fr) 70px' } as CSSProperties}
          >
            <div className={s.thead} role="row">
              <span role="columnheader">DATE</span>
              <span role="columnheader">CATEGORY</span>
              <span role="columnheader">MINUTES</span>
            </div>
            {rows.map((r) => (
              <div key={`${r.date}|${r.category}`} className={s.tr} role="row">
                <span role="cell">{dayMonth(r.date)}</span>
                <span role="cell">{r.category}</span>
                <span role="cell" className={s.right}>
                  {r.minutes}
                </span>
              </div>
            ))}
          </div>
          <LoadMore
            hasMore={records.hasNextPage}
            loading={records.isFetchingNextPage}
            onClick={() => void records.fetchNextPage()}
          />
        </>
      )}
      {(events.length > 0 || sessions.length > 0) && (
        <section className={s.section} aria-label="Only on this device">
          <CardLabel>ONLY ON THIS DEVICE</CardLabel>
          <p className={s.text}>
            {events.length} browsing events, {sessions.length} focus sessions and{' '}
            {device.rules.length} rules. They never leave this browser.
          </p>
          <div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                void device.clear().then(() => toast('This device’s wellbeing data is cleared.'))
              }
            >
              Clear this device
            </Button>
          </div>
        </section>
      )}
    </Drawer>
  );
}

function DeleteModal({
  open,
  onOpenChange,
  count,
  device,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  count: number | undefined;
  device: Device;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: deleteEverything,
    onSuccess: async () => {
      await device.clear();
      onOpenChange(false);
      toast('All wellbeing data deleted from the server.');
      void refresh(queryClient);
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      narrow
      title="Delete all wellbeing data?"
      description={`This removes ${count ?? 'all'} daily totals from the server right away and turns tracking off. It can't be undone.`}
    >
      <ModalActions>
        <Button variant="secondary" size="modal" onClick={() => onOpenChange(false)}>
          Keep my data
        </Button>
        <Button
          variant="danger"
          size="modal"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete everything
        </Button>
      </ModalActions>
    </Modal>
  );
}

function Consent({ settings, summary }: { settings: W.Settings | undefined; summary: W.Summary }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const counted =
    settings?.categories ?? summary.categories.filter((c) => c.counted).map((c) => c.category);
  const save = useMutation({
    mutationFn: (categories: W.Category[]) => updateSettings({ categories }),
    onMutate: async (categories) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const before = {
        settings: queryClient.getQueryData(settingsQuery.queryKey),
        summary: queryClient.getQueryData(summaryQuery.queryKey),
      };
      queryClient.setQueryData(settingsQuery.queryKey, (old) =>
        old ? { ...old, categories } : old,
      );
      queryClient.setQueryData(summaryQuery.queryKey, (old) =>
        old
          ? {
              ...old,
              categories: old.categories.map((c) => ({
                ...c,
                counted: categories.includes(c.category),
              })),
            }
          : old,
      );
      return before;
    },
    onError: (err, _vars, before) => {
      queryClient.setQueryData(settingsQuery.queryKey, before?.settings);
      queryClient.setQueryData(summaryQuery.queryKey, before?.summary);
      toast(message(err), 'ERROR');
    },
    onSettled: () => void refresh(queryClient),
  });
  return (
    <Card pad={16} gap={12}>
      <CardLabel>CONSENT · WHAT IS COUNTED</CardLabel>
      {CATEGORIES.map((c) => (
        <Switch
          key={c}
          label={LABEL[c]}
          checked={counted.includes(c)}
          onChange={(on) =>
            save.mutate(CATEGORIES.filter((x) => (x === c ? on : counted.includes(x))))
          }
        />
      ))}
      <span className={s.foot}>
        Stored: one total in minutes per category per day. Never URLs, page titles, app content or
        messages.
      </span>
    </Card>
  );
}

function Designed({ summary, settings }: { summary: W.Summary; settings: W.Settings | undefined }) {
  const max = Math.max(0, ...summary.categories.map((c) => c.minutes));
  const weekMax = Math.max(0, ...summary.series.map((d) => d.minutes));
  const compare =
    summary.average !== undefined &&
    summary.percentVsAverage !== undefined &&
    summary.direction !== undefined
      ? `${summary.percentVsAverage}% ${summary.direction} your 7-day average of ${fmtMin(summary.average)}.`
      : 'No 7-day average yet.';
  return (
    <div className={s.grid}>
      <Card pad={16} gap={12}>
        <CardLabel>TODAY · DAILY TOTALS</CardLabel>
        <span className={s.big}>{fmtMin(summary.todayMinutes)}</span>
        <span className={s.compare}>{compare}</span>
        <div className={s.cats}>
          {summary.categories.map((c) => (
            <div key={c.category} className={cx(s.cat, !c.counted && s.off)}>
              <span>{LABEL[c.category]}</span>
              <ProgressBar
                label={`${LABEL[c.category]} today`}
                percent={c.counted && max ? Math.round((c.minutes / max) * 100) : 0}
              />
              <span className={s.catValue}>{c.counted ? catValue(c.minutes) : 'off'}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card pad={16} gap={12}>
        <CardLabel>LAST 7 DAYS</CardLabel>
        <BarChart
          summary={summary.series
            .map((d) => `${dayMonth(d.date)}: ${(d.minutes / 60).toFixed(1)} hours`)
            .join(', ')}
          bars={summary.series.map((d, i) => ({
            key: d.date,
            value: `${(d.minutes / 60).toFixed(1)}h`,
            label: dayLetter(d.date),
            ratio: weekMax ? Math.round((d.minutes / weekMax) * 82) / 100 : 0,
            highlight: i === summary.series.length - 1,
          }))}
        />
      </Card>
      <Consent settings={settings} summary={summary} />
    </div>
  );
}

/** Module D: only the owner ever reaches it (students and mentors; others get the 403 page). */
export default function Page() {
  const user = useUser();
  const queryClient = useQueryClient();
  const toast = useToast();
  const device = useDevice(user.id);
  const summary = useQuery(summaryQuery);
  const settings = useQuery(settingsQuery);
  const [dataOpen, setDataOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const turnOn = useMutation({
    mutationFn: () => setTracking('on'),
    onSuccess: (next) => {
      applySettings(queryClient, next);
      toast('Tracking resumed.');
      void refresh(queryClient);
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });

  const status: Status | undefined = summary.data ?? settings.data;
  const area = AREA.wellbeing;
  let content;
  if (summary.isPending) content = <Loading what={WHAT} />;
  else if (summary.isError)
    content = <ErrorBox error={summary.error} what={WHAT} onRetry={() => void summary.refetch()} />;
  else if (summary.data.tracking === 'off' && summary.data.recordCount === 0)
    content = (
      <Empty
        title="Nothing stored"
        body="Tracking is off and the server holds no data for you. Turn it on to count daily totals by category."
        action={{ label: 'Turn on tracking', onClick: () => turnOn.mutate() }}
      />
    );
  else
    content = (
      <>
        <Designed summary={summary.data} settings={settings.data} />
        <DeviceCards device={device} summary={summary.data} settings={settings.data} />
      </>
    );

  return (
    <div data-mod="wellbeing" className={s.contents}>
      <PageHeader
        eyebrow={area.eyebrow}
        title={area.title}
        module="wellbeing"
        action={<span className={s.meta}>ONLY YOU CAN SEE THIS · NOT ADMINS, NOT MENTORS</span>}
      />
      <PrivacyBar
        status={status}
        loading={summary.isPending}
        device={device}
        onSeeData={() => setDataOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />
      {device.ready && device.mode === 'memory' && (
        <p className={s.notice}>
          This browser blocked local storage, so focus data stays in memory until you close the tab.
        </p>
      )}
      {content}
      <DataDrawer open={dataOpen} onOpenChange={setDataOpen} device={device} />
      <DeleteModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={summary.data?.recordCount}
        device={device}
      />
    </div>
  );
}
