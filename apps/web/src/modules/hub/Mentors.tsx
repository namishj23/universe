import { useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { hub } from '@universe/contracts';
import { clock } from '../../shell/format';
import { Button } from '../../shell/ui/Button';
import { cx } from '../../shell/ui/cx';
import { Field, FormError, Textarea } from '../../shell/ui/Field';
import { Modal, ModalActions } from '../../shell/ui/Overlay';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { LoadMore } from '../../shell/ui/Table';
import { useToast } from '../../shell/ui/Toast';
import { createRequest, decide, getMentor, getMentors, getMine, KEYS, message } from './api';
import { HUB_WHAT, slotLabel, weekdayShortTime } from './text';
import s from './Hub.module.css';

type MentorCard = hub.MentorCard;

function RequestModal({ mentor, onClose }: { mentor: MentorCard; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [slotId, setSlotId] = useState<string>('');
  const [note, setNote] = useState('');
  const profile = useQuery({
    queryKey: KEYS.mentor(mentor.mentorId),
    queryFn: ({ signal }) => getMentor(mentor.mentorId, signal),
  });
  const send = useMutation({
    mutationFn: () =>
      createRequest({
        mentorId: mentor.mentorId,
        ...(slotId && { slotId }),
        ...(note.trim() && { note: note.trim() }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast(`Request sent to ${mentor.name}.`);
      onClose();
    },
  });
  const slots = profile.data?.openSlots ?? [];
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Request ${mentor.name}`}
      description="Pick one of their free slots this week, or send without a time."
    >
      <form
        className={s.stack}
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <fieldset className={s.choices}>
          <legend className="uv-visually-hidden">Free slots</legend>
          {profile.isPending && <span className={s.small}>LOADING FREE SLOTS…</span>}
          {profile.isError && <FormError>{message(profile.error)}</FormError>}
          {slots.map((slot) => (
            <label key={slot.id} className={s.choice}>
              <input
                type="radio"
                name="slot"
                checked={slotId === slot.id}
                onChange={() => setSlotId(slot.id)}
              />
              <span className={s.mono}>{slotLabel(slot)}</span>
            </label>
          ))}
          <label className={s.choice}>
            <input
              type="radio"
              name="slot"
              checked={slotId === ''}
              onChange={() => setSlotId('')}
            />
            No fixed time: the mentor proposes one.
          </label>
        </fieldset>
        <Field label="NOTE">
          <Textarea
            rows={3}
            maxLength={500}
            value={note}
            placeholder="What would you like help with?"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {send.isError && <FormError>{message(send.error)}</FormError>}
        <ModalActions>
          <Button variant="secondary" size="modal" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="modal" disabled={send.isPending}>
            Send request
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function CancelModal({
  mentor,
  requestId,
  onClose,
}: {
  mentor: MentorCard;
  requestId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: () => decide(requestId, 'cancel'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast(`Request to ${mentor.name} cancelled.`);
      onClose();
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  return (
    <Modal
      open
      narrow
      onOpenChange={(o) => !o && onClose()}
      title="Cancel this request?"
      description={`${mentor.name} will see that you cancelled.`}
    >
      <ModalActions>
        <Button variant="secondary" size="modal" onClick={onClose}>
          Keep request
        </Button>
        <Button
          variant="danger"
          size="modal"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Cancel request
        </Button>
      </ModalActions>
    </Modal>
  );
}

/** `/rides?to=…&date=…&arriveBy=15:15` → "RIDE · ARRIVE BY 15:15 →". */
const arriveBy = (href: string) => new URLSearchParams(href.split('?')[1] ?? '').get('arriveBy');

function MentorRow({
  m,
  rideHref,
  onRequest,
  onCancel,
}: {
  m: MentorCard;
  rideHref: string | null;
  onRequest: () => void;
  onCancel: (requestId: string) => void;
}) {
  const r = m.myRequest;
  return (
    <article className={s.mentor} aria-label={`#${m.rank} ${m.name}`}>
      <span className={s.rank}>#{m.rank}</span>
      <div className={s.who}>
        <span className={s.name}>
          {m.name} {m.department && <span className={s.dept}>· {m.department}</span>}
        </span>
        <span className={s.why}>{m.reason}</span>
        <div className={s.tags}>
          {m.expertise.map((t) => (
            <span key={t} className={s.tag}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className={s.score}>
        <span className={s.scoreValue}>{m.score.toFixed(2)}</span>
        <span className={s.small}>
          {m.slotsThisWeek} {m.slotsThisWeek === 1 ? 'slot' : 'slots'} this week
        </span>
      </div>
      <div className={s.action}>
        {r.status === 'none' && (
          <button type="button" className={s.mentorButton} onClick={onRequest}>
            Request mentor
          </button>
        )}
        {r.status === 'pending' && (
          <button
            type="button"
            className={cx(s.mentorButton, s.requested)}
            onClick={() => onCancel(r.requestId)}
          >
            Requested
          </button>
        )}
        {r.status === 'accepted' && (
          <>
            <button type="button" className={cx(s.mentorButton, s.accepted)} disabled>
              Accepted · {weekdayShortTime(r.startsAt)}
            </button>
            {rideHref && (
              <Link className={s.rideLink} to={rideHref}>
                RIDE · ARRIVE BY {arriveBy(rideHref) ?? clock(r.startsAt)} →
              </Link>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** Students: the API's ranked mentors (never re-ranked here), request and cancel. */
export function Mentors() {
  const [requesting, setRequesting] = useState<MentorCard | null>(null);
  const [cancelling, setCancelling] = useState<{ m: MentorCard; requestId: string } | null>(null);
  const mentors = useInfiniteQuery({
    queryKey: KEYS.mentors,
    queryFn: ({ pageParam, signal }) => getMentors(signal, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  // Ride links live on the request, not the mentor card; one parallel query for all of them.
  const mine = useQuery({ queryKey: KEYS.mine, queryFn: ({ signal }) => getMine(signal) });

  if (mentors.isPending) return <Loading what={HUB_WHAT} />;
  if (mentors.isError)
    return (
      <ErrorBox error={mentors.error} what={HUB_WHAT} onRetry={() => void mentors.refetch()} />
    );
  const rows = mentors.data.pages.flatMap((p) => p.items);
  if (rows.length === 0)
    return (
      <Empty
        title="No mentors yet"
        body="Mentors appear here once they set up their profile and free slots."
      />
    );
  const rideFor = (requestId: string) =>
    mine.data?.items.find((x) => x.id === requestId)?.rideLink?.href ?? null;
  return (
    <>
      <div className={s.intro}>
        <span className={s.introText}>
          Ranked by how well their expertise matches the weak topics in your prep tracker, their
          free slots this week, and how many mentees they already have.
        </span>
        <span className={s.count}>{rows.length} MENTORS</span>
      </div>
      <div className={s.list}>
        {rows.map((m) => (
          <MentorRow
            key={m.mentorId}
            m={m}
            rideHref={m.myRequest.status === 'accepted' ? rideFor(m.myRequest.requestId) : null}
            onRequest={() => setRequesting(m)}
            onCancel={(requestId) => setCancelling({ m, requestId })}
          />
        ))}
      </div>
      <LoadMore
        hasMore={mentors.hasNextPage}
        loading={mentors.isFetchingNextPage}
        onClick={() => void mentors.fetchNextPage()}
      />
      {requesting && <RequestModal mentor={requesting} onClose={() => setRequesting(null)} />}
      {cancelling && (
        <CancelModal
          mentor={cancelling.m}
          requestId={cancelling.requestId}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}
