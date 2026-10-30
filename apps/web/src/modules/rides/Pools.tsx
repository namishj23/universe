import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { rides as R } from '@universe/contracts';
import { useActivity } from '../../shell/activity/ActivityProvider';
import { clock } from '../../shell/format';
import { Button } from '../../shell/ui/Button';
import { Segmented } from '../../shell/ui/Controls';
import { Input } from '../../shell/ui/Field';
import { MatchCard } from '../../shell/ui/MatchCard';
import { toneClass } from '../../shell/ui/Page';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { LoadMore, Row, Table } from '../../shell/ui/Table';
import { useToast } from '../../shell/ui/Toast';
import { Card, CardLabel } from '../../shell/ui/Widgets';
import { cx } from '../../shell/ui/cx';
import {
  CHAT_MAX,
  COMPLAINT_TAGS,
  isNotFound,
  keys,
  ridesApi,
  type ChatMessage,
  type ComplaintTag,
  type GroupDetail as Group,
  type GroupSummary,
  type PoolMatch,
} from './api';
import { dayTime, message, rupees, seatsLeft } from './format';
import s from './Rides.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_POOLS = {
  title: 'No auto pools yet',
  body: 'Find a ride and we group you with riders going your way, or join an open auto here.',
};

/**
 * Auto pools (not drawn by the design; built from Matches): pooled-auto groups for your ride
 * request (`GET /matches`) or, without one, the open groups (`GET /groups/available`).
 */
export function Pools() {
  const [params] = useSearchParams();
  const raw = params.get('requestId') ?? '';
  return UUID.test(raw) ? <PoolMatches requestId={raw} /> : <OpenGroups />;
}

function PoolMatches({ requestId }: { requestId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pools = useQuery({
    queryKey: keys.poolMatches(requestId),
    queryFn: ({ signal }) => ridesApi.poolMatches(requestId, signal),
  });
  const join = useMutation({
    mutationFn: (m: PoolMatch) => ridesApi.joinMatch(requestId, m.memberRideRequestIds),
    onSuccess: (g) => {
      void queryClient.invalidateQueries({ queryKey: keys.groups });
      toast('You joined the auto.');
      void navigate(`/rides/groups/${g.id}`);
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  if (pools.isPending) return <Loading what="auto pools" />;
  if (pools.isError)
    return <ErrorBox error={pools.error} what="auto pools" onRetry={() => void pools.refetch()} />;
  const { groups, hiddenByPreference } = pools.data;
  const meta = (
    <div className={s.summary}>
      <span className={s.summaryTitle}>Shared autos for your ride</span>
      <span className={s.meta}>
        {groups.length} {groups.length === 1 ? 'POOL' : 'POOLS'}
        {hiddenByPreference ? ` · ${hiddenByPreference} HIDDEN (WOMEN-ONLY PREFERENCE)` : ''}
      </span>
    </div>
  );
  if (!groups.length)
    return (
      <>
        {meta}
        <Empty
          title={NO_POOLS.title}
          body={NO_POOLS.body}
          action={{ label: 'Find a ride', onClick: () => void navigate('/rides') }}
        />
      </>
    );
  return (
    <>
      {meta}
      <div className={s.list}>
        {groups.map((m) => {
          const share = m.fare.members.find((x) => x.isYou)?.fareSharePaise;
          return (
            <MatchCard
              key={m.id}
              name={`Auto from ${m.pickupNode.name}`}
              sub={m.womenOnly ? 'women only' : `${m.members.length} riding`}
              route={`pickup ${m.pickupNode.name} · ${clock(m.pickupTime)}`}
              score={m.score.toFixed(2)}
              breakdown={[]}
              stats={[
                ['route similarity', m.routeSimilarity.toFixed(2)],
                ['overlap', `${Math.round(m.routeOverlap * 100)}%`],
                share !== undefined
                  ? ['your share', rupees(share)]
                  : ['fare', rupees(m.totalFarePaise)],
                seatsLeft(m.seatsLeft),
              ]}
              status={{ text: 'ELIGIBLE', tone: 'neutral' }}
              action={{
                label: 'Join',
                variant: 'primary',
                disabled: join.isPending,
                onClick: () => join.mutate(m),
              }}
            />
          );
        })}
      </div>
    </>
  );
}

function OpenGroups() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const groups = useInfiniteQuery({
    queryKey: [...keys.groups, 'available'],
    queryFn: ({ pageParam, signal }) => ridesApi.availableGroups(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const join = useMutation({
    mutationFn: (g: GroupSummary) => ridesApi.joinGroup(g.id),
    onSuccess: (g) => {
      void queryClient.invalidateQueries({ queryKey: keys.groups });
      toast('You joined the auto.');
      void navigate(`/rides/groups/${g.id}`);
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  if (groups.isPending) return <Loading what="auto pools" />;
  if (groups.isError)
    return (
      <ErrorBox error={groups.error} what="auto pools" onRetry={() => void groups.refetch()} />
    );
  const rows = groups.data.pages.flatMap((p) => p.items);
  if (!rows.length)
    return (
      <Empty
        title={NO_POOLS.title}
        body={NO_POOLS.body}
        action={{ label: 'Find a ride', onClick: () => void navigate('/rides') }}
      />
    );
  return (
    <div className={s.list}>
      <span className={s.muted}>
        Open shared autos, soonest first. Find a ride to see the pools ranked for your trip.
      </span>
      {rows.map((g) => (
        <MatchCard
          key={g.id}
          name={`${g.pickupName} → ${g.dropName}`}
          sub={g.womenOnly ? 'women only' : `${g.members.length} riding`}
          route={dayTime(g.pickupTime)}
          score={String(g.seatsLeft)}
          scoreLabel="SEATS LEFT"
          breakdown={[]}
          stats={[
            ['pickup', clock(g.pickupTime)],
            ['fare', rupees(g.fare.totalFarePaise)],
          ]}
          status={
            g.isMine
              ? { text: 'YOU ARE IN THIS AUTO', tone: 'ok' }
              : { text: (g.joinBlockedReason ?? 'OPEN').toUpperCase(), tone: 'neutral' }
          }
          action={
            g.isMine
              ? {
                  label: 'Open',
                  variant: 'secondary',
                  onClick: () => void navigate(`/rides/groups/${g.id}`),
                }
              : {
                  label: 'Join',
                  variant: 'primary',
                  disabled: join.isPending || Boolean(g.joinBlockedReason),
                  onClick: () => join.mutate(g),
                }
          }
        />
      ))}
      <LoadMore
        hasMore={groups.hasNextPage}
        loading={groups.isFetchingNextPage}
        onClick={() => void groups.fetchNextPage()}
      />
    </div>
  );
}

/** /rides/groups/:id: members, fare share, rider code, driver, chat and (after the ride) feedback. */
export function GroupDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const group = useQuery({
    queryKey: keys.group(id),
    queryFn: ({ signal }) => ridesApi.group(id, signal),
  });
  const me = useQuery({ queryKey: keys.me, queryFn: ({ signal }) => ridesApi.me(signal) });
  const leave = useMutation({
    mutationFn: () => ridesApi.leaveGroup(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.groups });
      toast('You left the auto.');
      void navigate('/rides/pools');
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  if (group.isPending) return <Loading what="this auto" />;
  if (group.isError)
    return isNotFound(group.error) ? (
      <Empty
        title="This auto is not yours to open"
        body="Only its riders can see a pooled auto."
        action={{ label: 'Auto pools', onClick: () => void navigate('/rides/pools') }}
      />
    ) : (
      <ErrorBox error={group.error} what="this auto" onRetry={() => void group.refetch()} />
    );
  const g = group.data;
  const you = g.fare.members.find((m) => m.isYou);
  return (
    <div className={s.grid}>
      <div className={s.stack}>
        <Card pad={16} gap={10} aria-labelledby="group-title">
          <span className={s.when}>{dayTime(g.pickupTime)}</span>
          <h2 id="group-title" className={s.summaryTitle}>
            Auto from {g.pickupNode.name}
          </h2>
          <span className={cx(s.status, toneClass(g.status === 'forming' ? 'warn' : 'ok'))}>
            ● {g.status}
            {g.womenOnly ? ' · women only' : ''}
          </span>
          <span className={s.line}>
            fare {rupees(g.totalFarePaise)}
            {you
              ? ` · your share ${rupees(you.fareSharePaise)} · saves ${rupees(you.savedPaise)}`
              : ''}
          </span>
          {me.data && (
            <span className={s.line}>
              RIDER CODE <b>{me.data.riderCode}</b> · show it to the driver when you board
            </span>
          )}
          <div className={s.row}>
            <Button
              variant="secondary"
              className={s.btn32}
              disabled={leave.isPending || Boolean(g.leaveLockedReason)}
              onClick={() => leave.mutate()}
            >
              Leave auto
            </Button>
            {g.leaveLockedReason && <span className={s.small}>{g.leaveLockedReason}</span>}
          </div>
        </Card>
        <Table
          label="Riders"
          columns="minmax(0,1.4fr) minmax(0,1fr) 80px 80px"
          headers={['RIDER', 'DROP', 'SHARE', 'BOARDED']}
        >
          {g.members.map((m) => (
            <Row key={m.rideRequestId}>
              <span className={s.title}>
                {m.name}
                {m.isYou ? ' (you)' : ''}
              </span>
              <span className={s.mono}>{m.dropNode.name}</span>
              <span className={s.mono}>{rupees(m.fareSharePaise)}</span>
              <span className={s.mono}>{m.boarded ? 'yes' : '—'}</span>
            </Row>
          ))}
        </Table>
        <DriverPanel group={g} />
      </div>
      <div className={s.stack}>
        <Chat groupId={g.id} />
        {g.status === 'completed' && g.boarded && <Feedback groupId={g.id} />}
      </div>
    </div>
  );
}

function DriverPanel({ group }: { group: Group }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const card = useQuery({
    queryKey: keys.driverCard(group.id),
    queryFn: ({ signal }) => ridesApi.driverCard(group.id, signal),
    enabled: group.driverAssigned,
  });
  const assign = useMutation({
    mutationFn: () => ridesApi.assignDriver(group.id),
    onSuccess: (d) => {
      queryClient.setQueryData(keys.driverCard(group.id), d);
      void queryClient.invalidateQueries({ queryKey: keys.group(group.id) });
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const d = card.data ?? assign.data;
  return (
    <Card pad={16} gap={8} aria-labelledby="driver-label">
      <CardLabel>
        <span id="driver-label">DRIVER AND VEHICLE</span>
      </CardLabel>
      {d ? (
        <>
          <span className={s.title}>
            {d.name} · {d.vehicle}, {d.plateNumber}
          </span>
          <span className={s.line}>
            arrives {clock(d.arrivesAt)} ·{' '}
            {d.accepted ? 'accepted' : 'waiting for the driver to accept'}
          </span>
          <span className={cx(s.status, toneClass(d.vehicleCheck.verified ? 'ok' : 'warn'))}>
            {d.vehicleCheck.verified
              ? `● vehicle checked · ${d.vehicleCheck.registrationNumber}`
              : '● vehicle check pending'}
            {d.vehicleCheck.serviceOverdue ? ' · service overdue' : ''}
          </span>
        </>
      ) : card.isError ? (
        <span className={s.muted}>{message(card.error)}</span>
      ) : group.driverAssigned ? (
        <span className={s.muted}>Loading…</span>
      ) : group.status === 'forming' ? (
        <span className={s.muted}>A driver is found once the auto is confirmed.</span>
      ) : (
        <div className={s.row}>
          <Button className={s.btn32} disabled={assign.isPending} onClick={() => assign.mutate()}>
            Find a driver
          </Button>
        </div>
      )}
    </Card>
  );
}

type ChatData = InfiniteData<{ items: ChatMessage[]; nextCursor: string | null }, string | null>;

function Chat({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const { subscribe } = useActivity();
  const toast = useToast();
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const key = keys.chat(groupId);
  const chat = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => ridesApi.chat(groupId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  // Newest first in the cache, as the API pages it; de-duplicated by id.
  useEffect(() => {
    const add = (m: ChatMessage) =>
      queryClient.setQueryData<ChatData>(keys.chat(groupId), (old) => {
        if (!old || old.pages.some((p) => p.items.some((x) => x.id === m.id))) return old;
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first!, items: [m, ...first!.items] }, ...rest] };
      });
    return subscribe('rides.chat', (data) => {
      const parsed = R.RidesChatMessage.safeParse(data);
      if (parsed.success && parsed.data.groupId === groupId) add(parsed.data);
    });
  }, [groupId, queryClient, subscribe]);

  const send = useMutation({
    mutationFn: (m: string) => ridesApi.sendChat(groupId, m),
    onSuccess: (m) => {
      setText('');
      atBottom.current = true;
      queryClient.setQueryData<ChatData>(key, (old) => {
        if (!old) return old;
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first!, items: [m, ...first!.items] }, ...rest] };
      });
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const messages = chat.data?.pages.flatMap((p) => p.items).reverse() ?? [];
  // Pinned to the newest message unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (m) send.mutate(m);
  };
  return (
    <Card pad={16} gap={10} aria-labelledby="chat-label">
      <CardLabel>
        <span id="chat-label">GROUP CHAT</span>
      </CardLabel>
      {chat.isError ? (
        <ErrorBox error={chat.error} what="the chat" onRetry={() => void chat.refetch()} />
      ) : (
        <div
          ref={box}
          className={s.chat}
          role="log"
          aria-label="Messages"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          <LoadMore
            hasMore={chat.hasNextPage}
            loading={chat.isFetchingNextPage}
            onClick={() => {
              atBottom.current = false;
              void chat.fetchNextPage();
            }}
            label="Load older"
          />
          {chat.isPending && <span className={s.muted}>Loading…</span>}
          {!chat.isPending && messages.length === 0 && (
            <span className={s.muted}>No messages yet. Say where you will wait.</span>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cx(s.message, m.isYou && s.mine)}>
              <span className={s.small}>
                {m.isYou ? 'you' : m.name} · {clock(m.createdAt)}
              </span>
              <span>{m.message}</span>
            </div>
          ))}
        </div>
      )}
      <form className={s.chatForm} onSubmit={submit}>
        <Input
          aria-label="Message"
          value={text}
          maxLength={CHAT_MAX}
          placeholder="Message the group"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" className={s.btn38} disabled={send.isPending || !text.trim()}>
          Send
        </Button>
      </form>
    </Card>
  );
}

const RATINGS = ['1', '2', '3', '4', '5'] as const;
type Rating = (typeof RATINGS)[number];

function Feedback({ groupId }: { groupId: string }) {
  const toast = useToast();
  const [cleanliness, setCleanliness] = useState<Rating>('5');
  const [condition, setCondition] = useState<Rating>('5');
  const [tags, setTags] = useState<ComplaintTag[]>([]);
  const send = useMutation({
    mutationFn: () =>
      ridesApi.feedback(groupId, {
        cleanliness: Number(cleanliness),
        condition: Number(condition),
        ...(tags.length && { tags }),
      }),
    onSuccess: () => toast('Thanks. Your rating is in.'),
    onError: (err) => toast(message(err), 'ERROR'),
  });
  if (send.isSuccess)
    return (
      <Card pad={16}>
        <CardLabel>RATE THE AUTO</CardLabel>
        <span className={s.muted}>Thanks. Your rating is in.</span>
      </Card>
    );
  const choices = RATINGS.map((r) => ({ id: r, label: r }));
  return (
    <Card pad={16} gap={12} aria-labelledby="rate-label">
      <CardLabel>
        <span id="rate-label">RATE THE AUTO</span>
      </CardLabel>
      <div className={s.stepField}>
        <span className={s.label} aria-hidden="true">
          CLEANLINESS
        </span>
        <Segmented
          label="Cleanliness"
          choices={choices}
          value={cleanliness}
          onChange={setCleanliness}
        />
      </div>
      <div className={s.stepField}>
        <span className={s.label} aria-hidden="true">
          CONDITION
        </span>
        <Segmented label="Condition" choices={choices} value={condition} onChange={setCondition} />
      </div>
      <div className={s.row} role="group" aria-label="What went wrong">
        {COMPLAINT_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={s.tag}
            aria-pressed={tags.includes(t)}
            onClick={() =>
              setTags((old) => (old.includes(t) ? old.filter((x) => x !== t) : [...old, t]))
            }
          >
            {t}
          </button>
        ))}
      </div>
      <div className={s.row}>
        <Button className={s.btn32} disabled={send.isPending} onClick={() => send.mutate()}>
          Send rating
        </Button>
      </div>
    </Card>
  );
}
