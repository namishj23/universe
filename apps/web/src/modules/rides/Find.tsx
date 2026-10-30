import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { localDate } from '../../shell/format';
import { Button } from '../../shell/ui/Button';
import { cx } from '../../shell/ui/cx';
import { Field, FormError, Input, Select } from '../../shell/ui/Field';
import { toneClass, type Tone } from '../../shell/ui/Page';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { keys, ridesApi, type Graph, type Offer, type GroupSummary } from './api';
import { dayTime, message } from './format';
import s from './Rides.module.css';

export const RIDES_EMPTY = {
  title: 'No rides yet',
  body: 'Request a ride or offer seats in your car. Matches appear within seconds.',
  action: 'Find a ride',
};

/** The stop graph, loaded once per visit (it changes only with a deploy). */
export const useGraph = () =>
  useQuery({
    queryKey: keys.graph,
    queryFn: ({ signal }) => ridesApi.graph(signal),
    staleTime: Infinity,
  });

/** Stops a car can reach, for the FROM and TO selects (walk-only campus points are left out). */
export const drivable = (g: Graph) => g.nodes.filter((n) => !n.walkOnly);

const DEFAULT_TIME = '08:10';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Today if that time is still ahead, else tomorrow. */
const nextDate = (time: string, now = new Date()) => {
  const today = localDate(now);
  return new Date(`${today}T${time}`) > now
    ? today
    : localDate(new Date(now.getTime() + 86_400_000));
};

interface YourRide {
  id: string;
  href: string;
  at: string;
  title: string;
  status: string;
  tone: Tone;
  confirmed: boolean;
}
const LIVE_OFFER = new Set(['open', 'full', 'departed']);
function yourRides(bookings: Offer[], groups: GroupSummary[]): YourRide[] {
  const fromBookings = bookings.flatMap((o) => {
    const mine = o.bookings.find(
      (b) => b.isYou && (b.status === 'accepted' || b.status === 'requested'),
    );
    if (!mine || !LIVE_OFFER.has(o.status)) return [];
    const accepted = mine.status === 'accepted';
    return [
      {
        id: o.id,
        href: `/rides/offers/${o.id}`,
        at: mine.plannedPickupAt,
        title: `${mine.pickup.name} → ${mine.drop.name}`,
        status: accepted
          ? `● confirmed · ${o.driverFirstName} driving`
          : `● requested · waiting for ${o.driverFirstName}`,
        tone: accepted ? ('ok' as const) : ('warn' as const),
        confirmed: accepted,
      },
    ];
  });
  const fromGroups = groups
    .filter((g) => !g.isPast && g.status !== 'cancelled' && g.status !== 'completed')
    .map((g) => {
      const confirmed = g.status !== 'forming';
      return {
        id: g.id,
        href: `/rides/groups/${g.id}`,
        at: g.pickupTime,
        title: `${g.pickupName} → ${g.dropName}`,
        status: confirmed
          ? `● confirmed · auto, ${g.members.length} sharing`
          : `● searching, no match yet`,
        tone: confirmed ? ('ok' as const) : ('warn' as const),
        confirmed,
      };
    });
  return [...fromBookings, ...fromGroups].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 6);
}

function YourRides() {
  const bookings = useQuery({
    queryKey: keys.bookings,
    queryFn: ({ signal }) => ridesApi.myBookings(signal),
  });
  const groups = useQuery({
    queryKey: keys.groups,
    queryFn: ({ signal }) => ridesApi.myGroups(signal),
  });
  const rides =
    bookings.data && groups.data ? yourRides(bookings.data.items, groups.data.items) : null;
  return (
    <section className={s.panel} aria-labelledby="your-rides">
      <h2 id="your-rides" className={s.label}>
        YOUR RIDES
      </h2>
      {bookings.isError || groups.isError ? (
        <span className={s.muted}>Couldn&apos;t load your rides.</span>
      ) : !rides ? (
        <span className={s.muted} aria-busy="true">
          Loading…
        </span>
      ) : rides.length === 0 ? (
        <span className={s.muted}>Nothing booked yet.</span>
      ) : (
        rides.map((r) => (
          <Link key={r.id} to={r.href} className={cx(s.ride, !r.confirmed && s.dashed)}>
            <span className={s.when}>{dayTime(r.at)}</span>
            <span className={s.title}>{r.title}</span>
            <span className={cx(s.status, toneClass(r.tone))}>{r.status}</span>
          </Link>
        ))
      )}
    </section>
  );
}

/** Find a ride: FROM, TO, DATE, PICKUP AROUND (or ARRIVE BY from a mentor session link). */
export function FindRide() {
  const graph = useGraph();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const arriveBy = HHMM.test(params.get('arriveBy') ?? '') ? params.get('arriveBy') : null;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [time, setTime] = useState(DEFAULT_TIME);
  const [date, setDate] = useState(() => {
    const d = params.get('date');
    return d && YMD.test(d) ? d : nextDate(DEFAULT_TIME);
  });
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(Boolean(arriveBy));
  const bookings = useQuery({
    queryKey: keys.bookings,
    queryFn: ({ signal }) => ridesApi.myBookings(signal),
  });
  const groups = useQuery({
    queryKey: keys.groups,
    queryFn: ({ signal }) => ridesApi.myGroups(signal),
  });

  const create = useMutation({
    mutationFn: ridesApi.createRequest,
    onSuccess: (req) => {
      queryClient.setQueryData(keys.request(req.id), req);
      void navigate(`/rides/matches?requestId=${req.id}`);
    },
    onError: (err) => setError(message(err)),
  });

  if (graph.isPending || create.isPending) return <Loading what="rides" />;
  if (graph.isError)
    return <ErrorBox error={graph.error} what="rides" onRetry={() => void graph.refetch()} />;
  const stops = drivable(graph.data);
  const spit = stops.find((n) => n.shortName === 'SPIT') ?? stops.find((n) => n.area === 'campus');
  const toId = to || spit?.id || '';
  const fromId = from || stops.find((n) => n.id !== toId)?.id || '';
  const nothingYet =
    !showForm &&
    bookings.data &&
    groups.data &&
    yourRides(bookings.data.items, groups.data.items).length === 0;
  if (nothingYet)
    return (
      <Empty
        title={RIDES_EMPTY.title}
        body={RIDES_EMPTY.body}
        action={{ label: RIDES_EMPTY.action, onClick: () => setShowForm(true) }}
      />
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (fromId === toId) {
      setError('Pick two different stops.');
      return;
    }
    if (!YMD.test(date) || (!arriveBy && !HHMM.test(time))) {
      setError('Pick a date and a time.');
      return;
    }
    setError('');
    create.mutate({
      pickupNodeId: fromId,
      dropNodeId: toId,
      ...(arriveBy
        ? { arriveBy: `${date}T${arriveBy}:00+05:30` }
        : { pickupTime: new Date(`${date}T${time}`).toISOString() }),
    });
  };
  const options = stops.map((n) => (
    <option key={n.id} value={n.id}>
      {n.name}
    </option>
  ));
  return (
    <div className={s.grid}>
      <form className={s.form} onSubmit={submit} noValidate>
        <div className={s.fields}>
          <Field label="FROM">
            <Select
              value={fromId}
              onChange={(e) => {
                setFrom(e.target.value);
                setError('');
              }}
            >
              {options}
            </Select>
          </Field>
          <Field label="TO">
            <Select
              value={toId}
              onChange={(e) => {
                setTo(e.target.value);
                setError('');
              }}
            >
              {options}
            </Select>
          </Field>
          <Field label="DATE">
            <Input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </Field>
          {!arriveBy && (
            <Field label="PICKUP AROUND">
              <Input type="time" value={time} required onChange={(e) => setTime(e.target.value)} />
            </Field>
          )}
        </div>
        {arriveBy && (
          <span className={s.arriveBy}>ARRIVE BY {arriveBy} · FROM YOUR MENTOR SESSION</span>
        )}
        {error && <FormError>{error}</FormError>}
        <div className={s.footer}>
          <span className={s.footNote}>
            We look for cars already heading your way within 10 minutes of this time.
          </span>
          <Button type="submit" className={s.btn38}>
            Find matches
          </Button>
        </div>
      </form>
      <YourRides />
    </div>
  );
}
