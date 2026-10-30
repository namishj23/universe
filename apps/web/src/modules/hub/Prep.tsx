import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { hub } from '@universe/contracts';
import { Button } from '../../shell/ui/Button';
import { Modal, ModalActions } from '../../shell/ui/Overlay';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { Row, Table } from '../../shell/ui/Table';
import { useToast } from '../../shell/ui/Toast';
import { Card, CardLabel, GoalGrid, ProgressBar } from '../../shell/ui/Widgets';
import { getPrep, increment, KEYS, message, trackTopics } from './api';
import { HUB_WHAT } from './text';
import s from './Hub.module.css';

type PrepView = hub.PrepView;
const COLUMNS = 'minmax(0,1.3fr) 90px minmax(0,2fr) 64px';

/** Only the clicked cell moves at once; OVERALL and the goal wait for the server's numbers. */
function bumpCell(view: PrepView, topicId: string): PrepView {
  return {
    ...view,
    tracks: view.tracks.map((t) => ({
      ...t,
      topics: t.topics.map((p) =>
        p.topicId === topicId
          ? { ...p, solved: p.solved + 1, percent: Math.round(((p.solved + 1) / p.total) * 100) }
          : p,
      ),
    })),
  };
}

function AddTopics({
  view,
  open,
  onOpenChange,
}: {
  view: PrepView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const tracked = view.tracks.flatMap((t) => t.topics.map((p) => p.topicId));
  const save = useMutation({
    mutationFn: () => trackTopics([...tracked, ...picked]),
    onSuccess: (next) => {
      queryClient.setQueryData(KEYS.prep, next);
      void queryClient.invalidateQueries({ queryKey: KEYS.mentors });
      setPicked([]);
      onOpenChange(false);
      toast('Topics added. Mentor ranking updated.');
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add topics">
      <fieldset className={s.choices}>
        <legend className="uv-visually-hidden">Topics to track</legend>
        {view.untracked.map((t) => (
          <label key={t.topicId} className={s.choice}>
            <input
              type="checkbox"
              checked={picked.includes(t.topicId)}
              onChange={(e) =>
                setPicked((p) =>
                  e.target.checked ? [...p, t.topicId] : p.filter((x) => x !== t.topicId),
                )
              }
            />
            {t.name} <span className={s.small}>{t.total}</span>
          </label>
        ))}
      </fieldset>
      <ModalActions>
        <Button variant="secondary" size="modal" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          size="modal"
          disabled={picked.length === 0 || save.isPending}
          onClick={() => save.mutate()}
        >
          Add topics
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function Prep() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const prep = useQuery({ queryKey: KEYS.prep, queryFn: ({ signal }) => getPrep(signal) });
  const inc = useMutation({
    mutationFn: (topicId: string) => increment(topicId, crypto.randomUUID()),
    onMutate: async (topicId) => {
      await queryClient.cancelQueries({ queryKey: KEYS.prep });
      const before = queryClient.getQueryData<PrepView>(KEYS.prep);
      if (before) queryClient.setQueryData(KEYS.prep, bumpCell(before, topicId));
      return { before };
    },
    onError: (err, _topicId, ctx) => {
      if (ctx?.before) queryClient.setQueryData(KEYS.prep, ctx.before);
      toast(message(err), 'ERROR');
    },
    onSuccess: (res) =>
      queryClient.setQueryData<PrepView>(KEYS.prep, (view) =>
        view
          ? {
              ...view,
              dsa: res.dsa,
              week: res.week,
              tracks: view.tracks.map((t) => ({
                ...t,
                topics: t.topics.map((p) => (p.topicId === res.topic.topicId ? res.topic : p)),
              })),
            }
          : view,
      ),
  });

  if (prep.isPending) return <Loading what={HUB_WHAT} />;
  if (prep.isError)
    return <ErrorBox error={prep.error} what={HUB_WHAT} onRetry={() => void prep.refetch()} />;
  const view = prep.data;
  const topics = view.tracks.flatMap((t) => t.topics);
  if (topics.length === 0)
    return (
      <>
        <Empty
          title="Your prep tracker is empty"
          body="Pick the topics you are preparing and we will rank mentors who cover them."
          action={{ label: 'Add topics', onClick: () => setAdding(true) }}
        />
        <AddTopics view={view} open={adding} onOpenChange={setAdding} />
      </>
    );
  const { week } = view;
  const focus = view.focusStudyMinutesThisWeek;
  return (
    <div className={s.prep}>
      <div className={s.prepTable}>
        <Table
          label="Prep tracker"
          columns={COLUMNS}
          rowPad="11px 14px"
          headers={[
            'TOPIC',
            'SOLVED',
            'PROGRESS',
            <span key="a" className="uv-visually-hidden">
              Add one
            </span>,
          ]}
        >
          {topics.map((p) => (
            <Row key={p.topicId}>
              <span role="cell" className={s.topic}>
                {p.name}
              </span>
              <span role="cell" className={s.solved}>
                {p.solved}
                <span className={s.muted}>/{p.total}</span>
              </span>
              <span role="cell" className={s.progress}>
                <ProgressBar percent={p.percent} label={`${p.name} progress`} />
                <span className={s.pct}>{p.percent}%</span>
              </span>
              <span role="cell" style={{ display: 'grid' }}>
                <button
                  type="button"
                  className={s.inc}
                  aria-label={`Add one solved: ${p.name}`}
                  disabled={p.solved >= p.total}
                  onClick={() => inc.mutate(p.topicId)}
                >
                  +1
                </button>
              </span>
            </Row>
          ))}
        </Table>
      </div>
      <div className={s.prepSide}>
        <Card>
          <CardLabel>OVERALL</CardLabel>
          <span className={s.big}>{view.dsa.percent}%</span>
          <span className={s.cardText}>
            {view.dsa.solved} of {view.dsa.total} problems on the DSA sheet.
          </span>
        </Card>
        <Card>
          <CardLabel>THIS WEEK&apos;S GOAL · ENDS SAT</CardLabel>
          <GoalGrid done={Math.min(week.done, week.target)} total={week.target} />
          <span className={s.cardText}>
            {week.done} of {week.target} done, {week.left} left.
          </span>
        </Card>
        {focus !== undefined && (
          <Card>
            <CardLabel>FOCUS · FROM WELLBEING</CardLabel>
            <span className={s.cardText}>
              {Math.floor(focus / 60)} h {focus % 60} m of focused study this week.
            </span>
          </Card>
        )}
        {view.untracked.length > 0 && (
          <div className={s.toolbar}>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add topics
            </Button>
          </div>
        )}
      </div>
      <AddTopics view={view} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
