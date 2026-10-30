import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clock } from '../../shell/format';
import { MatchCard } from '../../shell/ui/MatchCard';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { StopGraph } from '../../shell/ui/StopGraph';
import { useToast } from '../../shell/ui/Toast';
import { keys, ridesApi, type OfferMatch, type RideRequest } from './api';
import { RIDES_EMPTY, useGraph } from './Find';
import { dayMonth, km, message, seatsLeft } from './format';
import { routeThrough, shortestPath } from './graph';
import s from './Rides.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOf(m: OfferMatch) {
  if (m.booking?.status === 'accepted')
    return { text: 'JOINED · YOU ARE IN THIS CAR', tone: 'ok' as const };
  if (m.booking?.status === 'requested')
    return { text: 'REQUESTED · WAITING FOR DRIVER', tone: 'warn' as const };
  if (m.eligible) return { text: 'ELIGIBLE', tone: 'neutral' as const };
  return { text: (m.reasonText ?? 'NOT ELIGIBLE').toUpperCase(), tone: 'neutral' as const };
}

/** `3 MATCHES · 1 HIDDEN (PICKUP 08:25 IS OUTSIDE ±10 MIN)`, all from the API. */
function countLine(n: number, hidden: { total: number; reasons: { message: string }[] }) {
  const count = `${n} ${n === 1 ? 'MATCH' : 'MATCHES'}`;
  if (!hidden.total) return count;
  const why = hidden.reasons.map((r) => r.message).join(' · ');
  return `${count} · ${hidden.total} HIDDEN${why ? ` (${why.toUpperCase()})` : ''}`;
}

/** Matches: carpool offers for one ride request, scored by the API, beside the stop graph. */
export function Matches({ onRequest }: { onRequest: (id: string) => void }) {
  const [params] = useSearchParams();
  const raw = params.get('requestId') ?? '';
  const requestId = UUID.test(raw) ? raw : null;
  const navigate = useNavigate();
  useEffect(() => {
    if (requestId) onRequest(requestId);
  }, [requestId, onRequest]);
  if (!requestId)
    return (
      <Empty
        title={RIDES_EMPTY.title}
        body={RIDES_EMPTY.body}
        action={{ label: RIDES_EMPTY.action, onClick: () => void navigate('/rides') }}
      />
    );
  return <MatchList requestId={requestId} />;
}

function MatchList({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const graph = useGraph();
  const matches = useQuery({
    queryKey: keys.offerMatches(requestId),
    queryFn: ({ signal }) => ridesApi.offerMatches(requestId, signal),
  });
  // Only the request created on this visit is known; the API has no GET for one request.
  const request = queryClient.getQueryData<RideRequest>(keys.request(requestId));
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.offerMatches(requestId) });
    void queryClient.invalidateQueries({ queryKey: keys.bookings });
  };
  const book = useMutation({
    mutationFn: (m: OfferMatch) => ridesApi.bookSeat(m.offerId, requestId),
    onSuccess: (_offer, m) => {
      refresh();
      toast(`Request sent to ${m.driverFirstName}.`);
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const cancel = useMutation({
    mutationFn: (bookingId: string) => ridesApi.cancelBooking(bookingId),
    onSuccess: () => {
      refresh();
      toast('Request cancelled.');
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });

  const list = matches.data?.matches;
  const sel = list?.find((m) => m.offerId === selected) ?? list?.[0];
  const pickup = request?.pickup ?? list?.[0]?.pickupNode;
  const drop = request?.drop ?? list?.[0]?.dropNode;
  const mine = useMemo(
    () => (graph.data && pickup && drop ? shortestPath(graph.data, pickup.id, drop.id) : []),
    [graph.data, pickup, drop],
  );
  const theirs = useMemo(
    () => (graph.data && sel ? routeThrough(graph.data, sel.route) : []),
    [graph.data, sel],
  );

  if (matches.isPending || graph.isPending) return <Loading what="rides" />;
  if (matches.isError || graph.isError) {
    const error = matches.error ?? graph.error;
    return (
      <ErrorBox
        error={error}
        what="rides"
        onRetry={() => {
          void matches.refetch();
          void graph.refetch();
        }}
      />
    );
  }
  const { hidden } = matches.data;
  const names = new Map(graph.data.nodes.map((n) => [n.id, n.name]));
  const when = request ? new Date(request.pickupTime) : sel ? new Date(sel.pickupAt) : null;
  const trip = [
    when && dayMonth(when),
    pickup && drop && `${pickup.name} → ${drop.name}`,
    request && `around ${clock(request.pickupTime)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const summary = (
    <div className={s.summary}>
      <span className={s.summaryTitle}>{trip || 'Your ride request'}</span>
      <span className={s.meta}>{countLine(list?.length ?? 0, hidden)}</span>
    </div>
  );
  if (!list?.length || !sel)
    return (
      <>
        {summary}
        <Empty
          title="No cars match yet"
          body="We look for cars already heading your way within 10 minutes of this time. Try another time, or an auto pool."
          action={{ label: RIDES_EMPTY.action, onClick: () => void navigate('/rides') }}
        />
      </>
    );
  const busy = book.isPending || cancel.isPending;
  return (
    <>
      {summary}
      <div className={s.gridWide}>
        <section className={s.graphCard} aria-labelledby="stop-graph">
          <div className={s.graphHead}>
            <h2 id="stop-graph" className={s.label}>
              STOP GRAPH
            </h2>
            <div className={s.legend} aria-hidden="true">
              <span className={s.legendItem}>
                <span className={s.swatch} />
                you
              </span>
              <span className={s.legendItem}>
                <span className={`${s.swatch} ${s.swatchTheirs}`} />
                their route
              </span>
              <span className={s.legendItem}>
                <span className={`${s.swatch} ${s.swatchShared}`} />
                shared
              </span>
            </div>
          </div>
          <StopGraph
            stops={graph.data.nodes}
            edges={graph.data.edges}
            mine={mine}
            theirs={theirs}
            summary={[
              `Your route: ${mine.map((id) => names.get(id)).join(' → ')}`,
              `${sel.driverFirstName}'s route: ${sel.route.join(' → ')}`,
            ]}
          />
          <span className={s.graphNote}>
            Routes are shortest paths on the campus stop graph. Shared segments count toward route
            similarity.
          </span>
        </section>
        <div className={s.list} role="group" aria-label="Matches">
          {list.map((m) => {
            const w = m.weights;
            const booking = m.booking;
            return (
              <MatchCard
                key={m.offerId}
                name={m.driverFirstName}
                sub={m.womenOnly ? 'women only · driving' : 'driving'}
                route={m.route.join(' → ')}
                score={m.score.toFixed(2)}
                breakdown={[
                  {
                    label: `route similarity ${m.routeSimilarity.toFixed(2)} × ${w.routeSimilarity}`,
                    points: (m.routeSimilarity * w.routeSimilarity).toFixed(2),
                  },
                  {
                    label: `time fit ${m.timeFit.toFixed(2)} × ${w.timeFit}`,
                    note: `(${m.minutesApart} min apart)`,
                    points: (m.timeFit * w.timeFit).toFixed(2),
                  },
                ]}
                stats={[
                  ['detour', `+${km(m.addedDetourMetres)}`],
                  ['overlap', `${Math.round(m.overlapRatio * 100)}%`],
                  ['pickup', clock(m.pickupAt)],
                  seatsLeft(m.seatsLeft),
                ]}
                status={statusOf(m)}
                action={
                  booking?.status === 'accepted'
                    ? { label: 'Joined', variant: 'secondary', disabled: true, onClick: () => {} }
                    : booking
                      ? {
                          label: 'Cancel request',
                          variant: 'secondary',
                          disabled: busy,
                          onClick: () => cancel.mutate(booking.id),
                        }
                      : {
                          label: 'Request to join',
                          variant: 'primary',
                          disabled: busy || !m.eligible,
                          onClick: () => book.mutate(m),
                        }
                }
                selected={m.offerId === sel.offerId}
                onSelect={() => setSelected(m.offerId)}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
