import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clock, localDate } from '../../shell/format';
import { Button } from '../../shell/ui/Button';
import { cx } from '../../shell/ui/cx';
import { Field, Input, Select } from '../../shell/ui/Field';
import { Modal, ModalActions } from '../../shell/ui/Overlay';
import { toneClass } from '../../shell/ui/Page';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { useToast } from '../../shell/ui/Toast';
import { Stepper } from '../../shell/ui/Widgets';
import { isNotFound, keys, ridesApi, type CarpoolDriver, type Graph, type Offer } from './api';
import { drivable, useGraph } from './Find';
import { dayTime, km, message, rupees } from './format';
import s from './Rides.module.css';

const LIVE = new Set(['open', 'full', 'departed']);
const MAX_RIDERS = 3;
const weekdayClock = (iso: string) =>
  `${new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(new Date(iso)).toUpperCase()} ${clock(iso)}`;
/** Today if that time is still ahead, else tomorrow. */
const nextDate = (time: string, now = new Date()) => {
  const today = localDate(now);
  return new Date(`${today}T${time}`) > now
    ? today
    : localDate(new Date(now.getTime() + 86_400_000));
};

/** Offer a ride (carpool drivers): the form, then JOIN REQUESTS for your next live offer. */
export function OfferRide() {
  const graph = useGraph();
  const carpool = useQuery({
    queryKey: keys.carpool,
    queryFn: ({ signal }) => ridesApi.carpool(signal),
  });
  const offers = useQuery({
    queryKey: keys.offers,
    queryFn: ({ signal }) => ridesApi.myOffers(signal),
    enabled: carpool.isSuccess,
  });
  if (carpool.isError && isNotFound(carpool.error))
    return (
      <Empty
        title="Offer seats in your car"
        body="Carpool drivers are approved by the admin office first: your car or bike, its insurance and PUC, your licence and an inspection certificate. Then you can publish rides here."
      />
    );
  if (graph.isPending || carpool.isPending || (carpool.isSuccess && offers.isPending))
    return <Loading what="rides" />;
  const error = graph.error ?? carpool.error ?? offers.error;
  if (error)
    return (
      <ErrorBox
        error={error}
        what="rides"
        onRetry={() => {
          void graph.refetch();
          void carpool.refetch();
          void offers.refetch();
        }}
      />
    );
  const driver = carpool.data!;
  if (driver.status !== 'approved' || !driver.canOffer)
    return (
      <Empty
        title={`Your driver application is ${driver.status === 'approved' ? 'waiting for documents' : driver.status}`}
        body={
          driver.documentsMessage ??
          driver.reviewNote ??
          'The admin office reviews it before you can offer rides.'
        }
      />
    );
  const live = (offers.data?.items ?? [])
    .filter((o) => LIVE.has(o.status))
    .sort((a, b) => a.departAt.localeCompare(b.departAt));
  const offer = live[0] ?? null;
  return <OfferForm key={offer?.id ?? 'new'} graph={graph.data!} driver={driver} offer={offer} />;
}

function OfferForm({
  graph,
  driver,
  offer,
}: {
  graph: Graph;
  driver: CarpoolDriver;
  offer: Offer | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const stops = drivable(graph);
  const spit = stops.find((n) => n.shortName === 'SPIT') ?? stops[0];
  const [from, setFrom] = useState(
    offer?.origin.id ?? stops.find((n) => n.id !== spit?.id)?.id ?? '',
  );
  const [to, setTo] = useState(offer?.destination.id ?? spit?.id ?? '');
  const [time, setTime] = useState(offer ? clock(offer.departAt) : '08:30');
  const accepted = offer?.bookings.filter((b) => b.status === 'accepted').length ?? 0;
  const maxSeats = Math.min(MAX_RIDERS, driver.vehicle.seats);
  const [seats, setSeats] = useState(Math.min(maxSeats, offer?.seats ?? maxSeats));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.offers });

  const publish = useMutation({
    mutationFn: () => {
      const date = offer ? localDate(new Date(offer.departAt)) : nextDate(time);
      const departAt = new Date(`${date}T${time}`).toISOString();
      if (!offer)
        return ridesApi.createOffer({ originNodeId: from, destNodeId: to, departAt, seats });
      // Only what changed: with accepted riders the API allows only some edits (409 otherwise).
      return ridesApi.updateOffer(offer.id, {
        ...(from !== offer.origin.id && { originNodeId: from }),
        ...(to !== offer.destination.id && { destNodeId: to }),
        ...(clock(offer.departAt) !== time && { departAt }),
        ...(seats !== offer.seats && { seats }),
      });
    },
    onSuccess: () => {
      refresh();
      toast(offer ? 'Ride updated.' : 'Ride published. Matching riders are notified.');
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accept' | 'decline' }) =>
      ridesApi.decideBooking(id, decision),
    onSuccess: refresh,
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const step = useMutation({
    mutationFn: (st: 'cancel' | 'depart' | 'complete') => ridesApi.offerStep(offer!.id, st),
    onSuccess: (_o, st) => {
      setConfirmCancel(false);
      refresh();
      toast(
        st === 'cancel'
          ? 'Ride cancelled. Your riders are told.'
          : st === 'depart'
            ? 'Marked departed.'
            : 'Ride completed.',
      );
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });

  const unchanged =
    offer !== null &&
    from === offer.origin.id &&
    to === offer.destination.id &&
    time === clock(offer.departAt) &&
    seats === offer.seats;
  const options = stops.map((n) => (
    <option key={n.id} value={n.id}>
      {n.name}
    </option>
  ));
  const requests = (offer?.bookings ?? []).filter((b) => b.status !== 'cancelled');
  const full = accepted >= seats;
  return (
    <div className={s.grid}>
      <form
        className={s.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (from === to) toast('Pick two different stops.', 'ERROR');
          else if (!/^\d{2}:\d{2}$/.test(time)) toast('Pick a time.', 'ERROR');
          else if (unchanged) toast('Nothing to change.', 'ERROR');
          else publish.mutate();
        }}
      >
        <h2 className={s.label}>OFFER A RIDE</h2>
        <div className={s.fields}>
          <Field label="FROM">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              {options}
            </Select>
          </Field>
          <Field label="TO">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {options}
            </Select>
          </Field>
          <Field label="LEAVING">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <div className={s.stepField}>
            <span className={s.label} aria-hidden="true">
              SEATS
            </span>
            <Stepper
              label="Seats"
              value={seats}
              min={Math.max(1, accepted)}
              max={maxSeats}
              onChange={setSeats}
            />
          </div>
        </div>
        <Field label="VEHICLE">
          <Input readOnly value={`${driver.vehicle.model} · ${driver.vehicle.plateNumber}`} />
        </Field>
        <div className={s.footer}>
          <span className={s.footNote}>Max 3 riders. You approve every request.</span>
          <Button
            type="submit"
            className={s.btn38}
            disabled={publish.isPending || offer?.status === 'departed'}
          >
            {offer ? 'Update ride' : 'Publish ride'}
          </Button>
        </div>
      </form>
      <section className={s.list} aria-labelledby="join-requests">
        <div className={s.joinHead}>
          <h2 id="join-requests" className={s.label}>
            {offer
              ? `JOIN REQUESTS · ${weekdayClock(offer.departAt)} FROM ${offer.origin.name.toUpperCase()}`
              : 'JOIN REQUESTS'}
          </h2>
          <span className={s.meta}>
            {accepted} OF {seats} SEATS TAKEN
          </span>
        </div>
        {!offer && <span className={s.muted}>Publish a ride and requests appear here.</span>}
        {offer && requests.length === 0 && (
          <span className={s.muted}>No requests yet. Matching riders see your ride now.</span>
        )}
        {requests.map((b) => (
          <div key={b.id} className={s.card}>
            <div className={s.who}>
              <span className={s.name}>{b.passengerFirstName}</span>
              <span className={s.line}>
                pickup {b.pickup.name} · {clock(b.plannedPickupAt)} · detour +{km(b.addedDetourM)}
              </span>
            </div>
            {b.status === 'requested' ? (
              <div className={s.actions}>
                <Button
                  variant="secondary"
                  className={s.btn32}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: b.id, decision: 'decline' })}
                >
                  Decline
                </Button>
                <Button
                  className={s.btn32}
                  disabled={full || decide.isPending}
                  onClick={() => decide.mutate({ id: b.id, decision: 'accept' })}
                >
                  Accept
                </Button>
              </div>
            ) : (
              <span className={cx(s.chip, b.status === 'accepted' ? s.chipOk : s.chipOff)}>
                {b.status === 'accepted' ? 'ACCEPTED' : 'DECLINED'}
              </span>
            )}
          </div>
        ))}
        {offer && (
          <div className={s.row}>
            {offer.status === 'departed' ? (
              <Button
                variant="secondary"
                className={s.btn32}
                disabled={step.isPending}
                onClick={() => step.mutate('complete')}
              >
                Mark completed
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  className={s.btn32}
                  disabled={step.isPending}
                  onClick={() => step.mutate('depart')}
                >
                  Mark departed
                </Button>
                <Button
                  variant="destructive"
                  className={s.btn32}
                  disabled={step.isPending}
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel ride
                </Button>
              </>
            )}
          </div>
        )}
      </section>
      <Modal
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        narrow
        title="Cancel this ride?"
        description={
          accepted
            ? `${accepted} ${accepted === 1 ? 'rider is' : 'riders are'} booked. They are told at once.`
            : 'Riders who asked to join are told at once.'
        }
      >
        <ModalActions>
          <Button variant="secondary" size="modal" onClick={() => setConfirmCancel(false)}>
            Keep the ride
          </Button>
          <Button
            variant="danger"
            size="modal"
            disabled={step.isPending}
            onClick={() => step.mutate('cancel')}
          >
            Cancel ride
          </Button>
        </ModalActions>
      </Modal>
    </div>
  );
}

/** /rides/offers/:id (week strip): your seat on someone's ride; the driver sees Offer a ride. */
export function OfferDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const offer = useQuery({
    queryKey: keys.offer(id),
    queryFn: ({ signal }) => ridesApi.offer(id, signal),
  });
  const cancel = useMutation({
    mutationFn: ridesApi.cancelBooking,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.offers });
      void queryClient.invalidateQueries({ queryKey: keys.bookings });
      toast('Seat given up.');
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  if (offer.isPending) return <Loading what="this ride" />;
  if (offer.isError)
    return isNotFound(offer.error) ? (
      <Empty
        title="This ride is no longer shared with you"
        body="Only the driver and riders with a live seat can open a ride."
        action={{ label: 'Find a ride', onClick: () => void navigate('/rides') }}
      />
    ) : (
      <ErrorBox error={offer.error} what="this ride" onRetry={() => void offer.refetch()} />
    );
  const o = offer.data;
  if (o.isDriver) return <Navigate to="/rides/offer" replace />;
  const mine = o.bookings.find((b) => b.isYou);
  return (
    <section className={s.panel} aria-labelledby="offer-title">
      <span className={s.when}>{dayTime(mine?.plannedPickupAt ?? o.departAt)}</span>
      <h2 id="offer-title" className={s.summaryTitle}>
        {o.driverFirstName} · driving {o.vehicle.model}, {o.vehicle.plateNumber}
      </h2>
      <span className={s.line}>{o.route.join(' → ')}</span>
      {mine && (
        <>
          <span className={cx(s.status, toneClass(mine.status === 'accepted' ? 'ok' : 'warn'))}>
            {mine.status === 'accepted'
              ? '● confirmed · you are in this car'
              : '● requested · waiting for driver'}
          </span>
          <span className={s.line}>
            pickup {mine.pickup.name} · {clock(mine.plannedPickupAt)} · drop {mine.drop.name} ·
            share {rupees(mine.costSharePaise)} · saves {rupees(mine.savingsPaise)} (estimate)
          </span>
          <div className={s.row}>
            <Button
              variant="secondary"
              className={s.btn32}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(mine.id)}
            >
              {mine.status === 'accepted' ? 'Give up my seat' : 'Cancel request'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
