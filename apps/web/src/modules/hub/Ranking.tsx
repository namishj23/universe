import { useInfiniteQuery } from '@tanstack/react-query';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { LoadMore, Row, Table } from '../../shell/ui/Table';
import { getRanking, KEYS } from './api';
import { HUB_WHAT } from './text';
import s from './Hub.module.css';

const COLUMNS = '40px minmax(0,1.3fr) minmax(0,1.6fr) 70px 90px 80px 90px';

/** Admins: the ranking over all students, in the Admin Users table style. */
export function Ranking() {
  const ranking = useInfiniteQuery({
    queryKey: KEYS.ranking,
    queryFn: ({ pageParam, signal }) => getRanking(signal, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  if (ranking.isPending) return <Loading what={HUB_WHAT} />;
  if (ranking.isError)
    return (
      <ErrorBox error={ranking.error} what={HUB_WHAT} onRetry={() => void ranking.refetch()} />
    );
  const rows = ranking.data.pages.flatMap((p) => p.items);
  if (rows.length === 0)
    return <Empty title="No mentors yet" body="Mentors appear here once they set up a profile." />;
  const weak = ranking.data.pages[0]?.weakTopics ?? [];
  return (
    <>
      {weak.length > 0 && (
        <span className={s.introText}>
          Ranked against the weakest topics across all students:{' '}
          {weak.map((t) => t.name).join(', ')}.
        </span>
      )}
      <Table
        label="Mentor ranking"
        columns={COLUMNS}
        minWidth="860px"
        headers={['RANK', 'MENTOR', 'WHY', 'SCORE', 'MENTEES', 'SLOTS', 'REQ. 30 D']}
      >
        {rows.map((m) => (
          <Row key={m.mentorId}>
            <span role="cell" className={s.cell}>
              #{m.rank}
            </span>
            <span role="cell" className={s.who}>
              <span className={s.topic}>{m.name}</span>
              <span className={s.small}>{m.department ?? '—'}</span>
            </span>
            <span role="cell" className={s.why}>
              {m.reason}
            </span>
            <span role="cell" className={s.cell}>
              {m.score.toFixed(2)}
            </span>
            <span role="cell" className={s.cell}>
              {m.mentees} / {m.capacity}
            </span>
            <span role="cell" className={s.cell}>
              {m.slotsThisWeek}
            </span>
            <span role="cell" className={s.cell}>
              {m.requestsLast30Days}
            </span>
          </Row>
        ))}
      </Table>
      <LoadMore
        hasMore={ranking.hasNextPage}
        loading={ranking.isFetchingNextPage}
        onClick={() => void ranking.fetchNextPage()}
      />
    </>
  );
}
