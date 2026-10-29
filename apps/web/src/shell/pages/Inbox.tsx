import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnnouncementResponse, type ActivityEvent, type ActivityModule } from '@universe/contracts';
import { api, ApiRequestError, request } from '../../platform/api';
import { useUser } from '../../platform/auth';
import { FEED_KEY, useActivity, useFeed, type Feed } from '../activity/ActivityProvider';
import { activityLine } from '../activity/text';
import { shortWhen } from '../format';
import { AREA } from '../modules';
import { Button } from '../ui/Button';
import { Chips } from '../ui/Controls';
import { cx } from '../ui/cx';
import { Textarea } from '../ui/Field';
import { PageHeader } from '../ui/Page';
import { Empty, ErrorBox, Loading } from '../ui/States';
import { useToast } from '../ui/Toast';
import s from './Inbox.module.css';

type Filter = 'all' | ActivityModule;
const MAX = 500;

/** Marks events read in the cached feed; returns the snapshot to roll back to. */
function useMarkRead() {
  const queryClient = useQueryClient();
  const { unread, setUnread } = useActivity();
  const toast = useToast();
  const apply = (match: (e: ActivityEvent) => boolean) => {
    const before = queryClient.getQueryData<Feed>(FEED_KEY);
    const at = new Date().toISOString();
    let changed = 0;
    queryClient.setQueryData<Feed>(
      FEED_KEY,
      (feed) =>
        feed && {
          ...feed,
          pages: feed.pages.map((p) => ({
            ...p,
            items: p.items.map((e) => {
              if (e.readAt || !match(e)) return e;
              changed += 1;
              return { ...e, readAt: at };
            }),
          })),
        },
    );
    return { before, changed };
  };
  const rollback = (
    ctx: { before: Feed | undefined; unread: number } | undefined,
    message: string,
  ) => {
    if (ctx) {
      queryClient.setQueryData(FEED_KEY, ctx.before);
      setUnread(() => ctx.unread);
    }
    toast(message, 'ERROR');
  };
  const one = useMutation({
    mutationFn: (id: string) => request(`/api/activity/${id}/read`, { method: 'POST' }),
    onMutate: (id) => {
      const { before, changed } = apply((e) => e.id === id);
      setUnread((n) => n - changed);
      return { before, unread };
    },
    onError: (_e, _id, ctx) => rollback(ctx, "Couldn't mark it read. Try again."),
  });
  const all = useMutation({
    mutationFn: () => request('/api/activity/read-all', { method: 'POST' }),
    onMutate: () => {
      const { before } = apply(() => true);
      setUnread(() => 0);
      return { before, unread };
    },
    onError: (_e, _v, ctx) => rollback(ctx, "Couldn't mark everything read. Try again."),
  });
  return { one, all };
}

function Announcement() {
  const [text, setText] = useState('');
  const toast = useToast();
  const send = useMutation({
    mutationFn: () =>
      api('/api/activity/announcements', AnnouncementResponse, {
        method: 'POST',
        body: { message: text.trim() },
      }),
    onSuccess: ({ recipients }) => {
      setText('');
      toast(`Sent to ${recipients} people.`);
    },
    onError: (err) =>
      toast(err instanceof ApiRequestError ? err.message : "Couldn't send. Try again.", 'ERROR'),
  });
  const empty = !text.trim();
  return (
    <section className={s.announce} aria-labelledby="announce-label">
      <span id="announce-label" className={s.label}>
        ANNOUNCEMENT TO EVERYONE
      </span>
      <Textarea
        aria-labelledby="announce-label"
        rows={2}
        maxLength={MAX}
        placeholder="Write a short announcement"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX))}
      />
      <div className={s.announceFoot}>
        <span className={s.count}>
          {text.length} / {MAX}
        </span>
        <Button disabled={empty || send.isPending} onClick={() => send.mutate()}>
          Send to everyone
        </Button>
      </div>
    </section>
  );
}

export function InboxPage() {
  const user = useUser();
  const feed = useFeed();
  const { one, all } = useMarkRead();
  const [filter, setFilter] = useState<Filter>('all');
  const now = new Date();
  const events = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const present = [...new Set(events.map((e) => e.module))];
  const choices = [
    { id: 'all' as Filter, label: 'All' },
    ...present.map((m) => ({ id: m, label: `${AREA[m].code} ${AREA[m].label}` })),
  ];
  const shown = events.filter((e) => filter === 'all' || e.module === filter);

  const header = (
    <PageHeader
      eyebrow="ACTIVITY · LIVE"
      title="Inbox"
      action={
        <Button variant="secondary" onClick={() => all.mutate()}>
          Mark all read
        </Button>
      }
    >
      <Chips label="Filter by module" choices={choices} value={filter} onChange={setFilter} />
    </PageHeader>
  );

  if (feed.isPending)
    return (
      <>
        {header}
        <Loading what="your inbox" />
      </>
    );
  if (feed.isError)
    return (
      <>
        {header}
        <ErrorBox error={feed.error} what="your inbox" onRetry={() => void feed.refetch()} />
      </>
    );

  return (
    <>
      {header}
      {user.role === 'admin' && <Announcement />}
      {events.length === 0 ? (
        <Empty
          title="No activity yet"
          body="Announcements and updates from every module arrive here live."
        />
      ) : (
        <ul className={s.list} aria-label="Activity">
          {shown.map((e) => {
            const line = activityLine(e, user);
            const unread = !e.readAt;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={cx(s.row, unread && s.unread)}
                  data-mod={e.module}
                  onClick={() => unread && one.mutate(e.id)}
                >
                  <span className={s.dot}>
                    {unread && <span className="uv-visually-hidden">Unread: </span>}
                  </span>
                  <span className={s.code} aria-hidden="true">
                    {AREA[e.module].code}
                  </span>
                  <span className={s.text}>
                    <span className={s.line}>
                      {line.who && <b>{line.who}</b>}
                      {line.who && ' '}
                      {line.text}
                    </span>
                    <span className={s.module}>{AREA[e.module].label.toUpperCase()}</span>
                  </span>
                  <span className={s.time}>{shortWhen(e.createdAt, now)}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className={s.none}>No activity from this module yet.</li>}
        </ul>
      )}
      {feed.hasNextPage && (
        <Button
          variant="secondary"
          className={s.more}
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? 'Loading…' : 'Load older'}
        </Button>
      )}
    </>
  );
}
