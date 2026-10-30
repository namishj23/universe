import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { ActivityEvent, pageOf, UnreadCount, type Page } from '@universe/contracts';
import { api, ApiRequestError, request } from '../../platform/api';

export const FEED_KEY = ['activity', 'feed'] as const;
const FeedPage = pageOf(ActivityEvent);
export type Feed = InfiniteData<Page<ActivityEvent>, string | null>;

/** The activity feed, newest first, 20 per page; live events are added by ActivityProvider. */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: FEED_KEY,
    queryFn: ({ pageParam, signal }) =>
      api(
        `/api/activity?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        FeedPage,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

function addToFeed(queryClient: QueryClient, event: ActivityEvent) {
  queryClient.setQueryData<Feed>(FEED_KEY, (feed) => {
    if (!feed || feed.pages.some((p) => p.items.some((e) => e.id === event.id))) return feed;
    const [first, ...rest] = feed.pages;
    if (!first) return feed;
    return { ...feed, pages: [{ ...first, items: [event, ...first.items] }, ...rest] };
  });
}

type Handler = (data: unknown) => void;
const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
interface ActivityContextValue {
  /** From the stream's `unread-count` messages, adjusted at once by optimistic reads. */
  unread: number;
  setUnread: (update: (n: number) => number) => void;
  /** Ephemeral named events (`rides.chat`): never stored, never in the feed. */
  subscribe: (name: string, handler: Handler) => () => void;
}
const ActivityContext = createContext<ActivityContextValue | null>(null);

/** Errors in a row (while the browser retries) before we take over and check the session. */
const MAX_SILENT_ERRORS = 3;
const backoff = (failures: number) => Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5));

/**
 * Exactly one EventSource per tab, for as long as the user is signed in. Events are
 * de-duplicated by id. When the stream fails repeatedly (or the server refuses it), one
 * `/api/auth/me` decides: a 401 signs out (through the API client), anything else backs off.
 */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [unread, setUnreadState] = useState(0);
  const handlers = useRef(new Map<string, Set<Handler>>());
  const source = useRef<{ es: EventSource; names: Set<string> } | null>(null);

  const listen = useCallback((current: { es: EventSource; names: Set<string> }, name: string) => {
    if (current.names.has(name)) return;
    current.names.add(name);
    current.es.addEventListener(name, (ev: MessageEvent<string>) => {
      const data = json(ev.data);
      if (data === undefined) return;
      for (const h of handlers.current.get(name) ?? []) h(data);
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let checking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();

    const recover = async () => {
      if (checking) return;
      checking = true;
      try {
        await request('/api/auth/me');
      } catch (err) {
        // 401: the API client has already signed out, which unmounts this provider.
        if (err instanceof ApiRequestError && err.status === 401) return;
      } finally {
        checking = false;
      }
      if (!stopped) timer = setTimeout(connect, backoff(failures));
    };

    function connect() {
      const es = new EventSource('/api/activity/stream');
      const current = { es, names: new Set<string>() };
      source.current = current;
      es.addEventListener('open', () => {
        failures = 0;
      });
      es.addEventListener('activity', (ev: MessageEvent<string>) => {
        const parsed = ActivityEvent.safeParse(json(ev.data));
        if (!parsed.success || seen.has(parsed.data.id)) return;
        seen.add(parsed.data.id);
        addToFeed(queryClient, parsed.data);
      });
      es.addEventListener('unread-count', (ev: MessageEvent<string>) => {
        const parsed = UnreadCount.safeParse(json(ev.data));
        if (parsed.success) setUnreadState(parsed.data.count);
      });
      for (const name of handlers.current.keys()) listen(current, name);
      es.addEventListener('error', () => {
        failures += 1;
        // While CONNECTING the browser retries by itself; a CLOSED stream was refused.
        if (es.readyState !== EventSource.CLOSED && failures < MAX_SILENT_ERRORS) return;
        es.close();
        if (!stopped) void recover();
      });
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source.current?.es.close();
      source.current = null;
    };
  }, [queryClient, listen]);

  const subscribe = useCallback(
    (name: string, handler: Handler) => {
      const set = handlers.current.get(name) ?? new Set<Handler>();
      set.add(handler);
      handlers.current.set(name, set);
      if (source.current) listen(source.current, name);
      return () => {
        set.delete(handler);
      };
    },
    [listen],
  );
  const setUnread = useCallback(
    (update: (n: number) => number) => setUnreadState((n) => Math.max(0, update(n))),
    [],
  );

  const value = useMemo(() => ({ unread, setUnread, subscribe }), [unread, setUnread, subscribe]);
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('useActivity must be used inside <ActivityProvider>');
  return value;
}
