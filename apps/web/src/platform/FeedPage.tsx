import { useEffect, useState, type FormEvent } from 'react';
import {
  ActivityEvent,
  AnnouncementResponse,
  UnreadCount,
  pageOf,
  type PublicUser,
} from '@universe/contracts';
import { api, ApiRequestError, formText, request } from './api';
import { useAuth } from './auth';

const FeedPage$ = pageOf(ActivityEvent);
const FEED_SIZE = 20;

const describe = (e: ActivityEvent) =>
  e.type === 'platform.announcement' ? (e.payload as { message: string }).message : e.type;

export function FeedPage({ user }: { user: PublicUser }) {
  const { logout } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      api(`/api/activity?limit=${FEED_SIZE}`, FeedPage$, { signal }),
      api('/api/activity/unread-count', UnreadCount, { signal }),
    ]).then(
      ([page, count]) => {
        setEvents(page.items);
        setUnread(count.count);
      },
      (err: unknown) => {
        if (!signal.aborted)
          setError(err instanceof ApiRequestError ? err.message : 'Could not load activity.');
      },
    );

    const source = new EventSource('/api/activity/stream');
    const onActivity = (message: MessageEvent<string>) => {
      const event = ActivityEvent.parse(JSON.parse(message.data));
      setEvents((current) =>
        [event, ...(current ?? []).filter((e) => e.id !== event.id)].slice(0, FEED_SIZE),
      );
    };
    const onUnread = (message: MessageEvent<string>) =>
      setUnread(UnreadCount.parse(JSON.parse(message.data)).count);
    source.addEventListener('activity', onActivity);
    source.addEventListener('unread-count', onUnread);
    return () => {
      controller.abort();
      source.removeEventListener('activity', onActivity);
      source.removeEventListener('unread-count', onUnread);
      source.close();
    };
  }, []);

  async function markAllRead() {
    await request('/api/activity/read-all', { method: 'POST' });
    const now = new Date().toISOString();
    setEvents((current) => current?.map((e) => ({ ...e, readAt: e.readAt ?? now })) ?? null);
    setUnread(0);
  }

  return (
    <main>
      <h1>
        {user.name} ({user.role})
      </h1>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
      <h2>Activity · {unread ?? '…'} unread</h2>
      <button type="button" onClick={() => void markAllRead()} disabled={!unread}>
        Mark all read
      </button>
      {error && <p role="alert">{error}</p>}
      {!error && events === null && <p>Loading activity…</p>}
      {events?.length === 0 && <p>No activity yet.</p>}
      <ul aria-label="Activity feed">
        {events?.map((e) => (
          <li key={e.id}>
            {e.readAt ? '' : '● '}
            {describe(e)} — {e.actor?.name ?? 'UniVerse'}, {new Date(e.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
      {user.role === 'admin' && <AnnouncementForm />}
    </main>
  );
}

function AnnouncementForm() {
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSending(true);
    try {
      const { recipients } = await api('/api/activity/announcements', AnnouncementResponse, {
        method: 'POST',
        body: { message: formText(new FormData(form), 'message') },
      });
      setStatus(`Sent to ${recipients} people.`);
      form.reset();
    } catch (err) {
      setStatus(err instanceof ApiRequestError ? err.message : 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <h2>Send an announcement (admin)</h2>
      <label>
        Message <textarea name="message" required maxLength={500} />
      </label>
      <button type="submit" disabled={sending}>
        Send to everyone
      </button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
