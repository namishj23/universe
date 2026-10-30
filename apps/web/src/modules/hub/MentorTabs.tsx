import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { hub } from '@universe/contracts';
import { ApiRequestError } from '../../platform/api';
import { shortWhen } from '../../shell/format';
import { Button } from '../../shell/ui/Button';
import { cx } from '../../shell/ui/cx';
import { Field, FormError, Input } from '../../shell/ui/Field';
import { Drawer, Modal, ModalActions } from '../../shell/ui/Overlay';
import { toneClass } from '../../shell/ui/Page';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { LoadMore, Row, Table } from '../../shell/ui/Table';
import { useToast } from '../../shell/ui/Toast';
import {
  createSlot,
  decide,
  deleteSlot,
  getIncoming,
  getSlots,
  getStudent,
  KEYS,
  message,
} from './api';
import { HUB_WHAT, slotLabel, weekdayShortTime, yearBranch } from './text';
import s from './Hub.module.css';

type Request = hub.MentorshipRequest;

/** "REQUESTED 20:31 · PREP 54%" while pending; "SESSION MON 15:30" once booked. */
function metaLine(r: Request) {
  if (r.status === 'accepted' && r.slot)
    return `SESSION ${weekdayShortTime(r.slot.startsAt).toUpperCase()}`;
  const requested = `REQUESTED ${shortWhen(r.createdAt).toUpperCase()}`;
  // A closed request's student is { id, name } only (P7-006).
  return 'dsaPercent' in r.student ? `${requested} · PREP ${r.student.dsaPercent}%` : requested;
}

const CHIP: Record<Exclude<hub.RequestStatus, 'pending'>, string> = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  cancelled: 'CANCELLED',
  completed: 'COMPLETED',
};

/** The "See my data" drawer style: the student card a mentor may see while the request lives. */
function StudentDrawer({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const card = useQuery({
    queryKey: KEYS.student(id),
    queryFn: ({ signal }) => getStudent(id, signal),
    retry: false,
  });
  const gone = card.error instanceof ApiRequestError && card.error.status === 404;
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={name}>
      {card.isPending && <Loading what="the student card" />}
      {gone && (
        <span className={s.note}>This student&apos;s card is no longer shared with you.</span>
      )}
      {card.isError && !gone && (
        <ErrorBox error={card.error} what="the student card" onRetry={() => void card.refetch()} />
      )}
      {card.data && (
        <dl className={s.facts}>
          <dt>YEAR</dt>
          <dd>{card.data.year ?? '—'}</dd>
          <dt>BRANCH</dt>
          <dd>{card.data.branch ?? '—'}</dd>
          <dt>DSA SHEET</dt>
          <dd className={s.mono}>{card.data.dsaPercent}%</dd>
          <dt>READINESS</dt>
          <dd className={s.mono}>{card.data.readiness}</dd>
        </dl>
      )}
    </Drawer>
  );
}

/** Mentors: incoming requests, Accept and Decline, then Mark completed. */
export function MentorRequests() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [viewing, setViewing] = useState<Request['student'] | null>(null);
  const incoming = useInfiniteQuery({
    queryKey: KEYS.incoming,
    queryFn: ({ pageParam, signal }) => getIncoming(signal, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const act = useMutation({
    mutationFn: ({ r, action }: { r: Request; action: 'accept' | 'decline' | 'complete' }) =>
      decide(r.id, action),
    onSuccess: (_res, { r, action }) => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (action === 'accept') toast(`${r.student.name} notified.`);
      if (action === 'complete') toast(`Session with ${r.student.name} marked completed.`);
    },
    // SLOT_TAKEN, NOT_STARTED and friends carry the server's own sentence.
    onError: (err) => toast(message(err), 'ERROR'),
  });

  if (incoming.isPending) return <Loading what={HUB_WHAT} />;
  if (incoming.isError)
    return (
      <ErrorBox error={incoming.error} what={HUB_WHAT} onRetry={() => void incoming.refetch()} />
    );
  const rows = incoming.data.pages.flatMap((p) => p.items);
  if (rows.length === 0)
    return (
      <Empty
        title="No mentorship requests yet"
        body="Students who pick you from the ranked list appear here. Add free slots so they can book a time."
      />
    );
  return (
    <>
      <div className={s.list}>
        {rows.map((r) => (
          <article key={r.id} className={s.request} aria-label={`Request from ${r.student.name}`}>
            <div className={s.requestText}>
              <span>
                <button
                  type="button"
                  className={s.nameButton}
                  onClick={() => setViewing(r.student)}
                >
                  {r.student.name}
                </button>
                {'year' in r.student && (
                  <>
                    {' '}
                    <span className={cx(s.name, s.dept)}>· {yearBranch(r.student)}</span>
                  </>
                )}
              </span>
              {r.note && <span className={s.note}>&quot;{r.note}&quot;</span>}
              <span className={s.small}>{metaLine(r)}</span>
            </div>
            {r.status === 'pending' ? (
              <div className={s.buttons}>
                <Button
                  variant="secondary"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ r, action: 'decline' })}
                >
                  Decline
                </Button>
                <Button
                  disabled={act.isPending}
                  onClick={() => act.mutate({ r, action: 'accept' })}
                >
                  Accept
                </Button>
              </div>
            ) : (
              <div className={s.buttons}>
                {r.status === 'accepted' && (
                  <Button
                    variant="secondary"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ r, action: 'complete' })}
                  >
                    Mark completed
                  </Button>
                )}
                <span className={cx(s.chip, r.status === 'accepted' && s.chipOk)}>
                  {CHIP[r.status]}
                </span>
              </div>
            )}
          </article>
        ))}
      </div>
      <LoadMore
        hasMore={incoming.hasNextPage}
        loading={incoming.isFetchingNextPage}
        onClick={() => void incoming.fetchNextPage()}
      />
      {viewing && (
        <StudentDrawer id={viewing.id} name={viewing.name} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

/** `2026-11-02` + `15:30` in the browser's zone → ISO with offset. */
function isoAt(date: string, time: string) {
  const d = new Date(`${date}T${time}:00`);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${date}T${time}:00${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

/** Not drawn by the design; built from the New user modal. */
function NewSlotModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('15:30');
  const [to, setTo] = useState('16:30');
  const [where, setWhere] = useState('');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () =>
      createSlot({
        startsAt: isoAt(date, from),
        endsAt: isoAt(date, to),
        ...(where.trim() && { locationLabel: where.trim() }),
      }),
    onSuccess: (slot) => {
      void queryClient.invalidateQueries({ queryKey: KEYS.slots });
      toast(`Slot added: ${slotLabel(slot)}.`);
      setError('');
      onOpenChange(false);
    },
    onError: (err) => setError(message(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minutes = (Date.parse(isoAt(date, to)) - Date.parse(isoAt(date, from))) / 60_000;
    if (!date) return setError('Pick a date.');
    if (!(minutes >= 30 && minutes <= 180)) return setError('A slot is 30 to 180 minutes long.');
    create.mutate();
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New slot">
      <form className={s.stack} onSubmit={submit} noValidate>
        <Field label="DATE">
          <Input type="date" mono value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className={s.pair}>
          <Field label="FROM">
            <Input type="time" mono value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="TO">
            <Input type="time" mono value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="WHERE">
          <Input
            value={where}
            maxLength={120}
            placeholder="Room 304, or online"
            onChange={(e) => setWhere(e.target.value)}
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <ModalActions>
          <Button variant="secondary" size="modal" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="modal" disabled={create.isPending}>
            Add slot
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

const SLOT_COLUMNS = 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 90px';

/** Mentors: free slots students can book. Built from the Prep tracker table. */
export function Slots() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const slots = useInfiniteQuery({
    queryKey: KEYS.slots,
    queryFn: ({ pageParam, signal }) => getSlots(signal, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSlot(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.slots });
      toast('Slot removed.');
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  const modal = <NewSlotModal open={creating} onOpenChange={setCreating} />;

  if (slots.isPending) return <Loading what="your slots" />;
  if (slots.isError)
    return <ErrorBox error={slots.error} what="your slots" onRetry={() => void slots.refetch()} />;
  const rows = slots.data.pages.flatMap((p) => p.items);
  if (rows.length === 0)
    return (
      <>
        <Empty
          title="No free slots yet"
          body="Add the times you can meet. Students pick one when they request you."
          action={{ label: 'New slot', onClick: () => setCreating(true) }}
        />
        {modal}
      </>
    );
  return (
    <>
      <div className={s.toolbar}>
        <Button size="lg" onClick={() => setCreating(true)}>
          New slot
        </Button>
      </div>
      <Table
        label="Free slots"
        columns={SLOT_COLUMNS}
        rowPad="11px 14px"
        minWidth="560px"
        headers={[
          'WHEN',
          'WHERE',
          'STATUS',
          <span key="a" className="uv-visually-hidden">
            Actions
          </span>,
        ]}
      >
        {rows.map((slot) => (
          <Row key={slot.id}>
            <span role="cell" className={s.solved}>
              {slotLabel({ ...slot, locationLabel: null })}
            </span>
            <span role="cell" className={s.by}>
              {slot.locationLabel ?? '—'}
            </span>
            <span
              role="cell"
              className={cx(s.cell, toneClass(slot.status === 'open' ? 'ok' : 'neutral'))}
            >
              {slot.status === 'booked' && slot.booking
                ? `BOOKED · ${slot.booking.studentName}`
                : slot.status.toUpperCase()}
            </span>
            <span role="cell" style={{ display: 'grid' }}>
              {slot.status === 'open' && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(slot.id)}
                >
                  Remove
                </Button>
              )}
            </span>
          </Row>
        ))}
      </Table>
      <LoadMore
        hasMore={slots.hasNextPage}
        loading={slots.isFetchingNextPage}
        onClick={() => void slots.fetchNextPage()}
      />
      {modal}
    </>
  );
}
