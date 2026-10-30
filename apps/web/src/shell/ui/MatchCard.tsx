import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { toneClass, type Tone } from './Page';
import s from './MatchCard.module.css';

export interface Breakdown {
  /** "route similarity 0.83 × 0.7" */
  label: ReactNode;
  /** "(1 min apart)", muted. */
  note?: string;
  /** "0.58" */
  points: string;
}

/**
 * A ride match (Rides · Matches, reused by Auto pools): name and route, the mono 28px score,
 * the score breakdown box, a stats row, the status and one action. The header is the select
 * button (`aria-pressed`); a click anywhere on the card selects it too.
 */
export function MatchCard({
  name,
  sub,
  route,
  score,
  scoreLabel = 'MATCH SCORE',
  breakdown,
  stats,
  status,
  action,
  selected,
  onSelect,
}: {
  name: string;
  sub?: string;
  route: string;
  score: string;
  scoreLabel?: string;
  breakdown: Breakdown[];
  /** [label, value] pairs ("detour", "+1.2 km") or plain text ("1 seat left"). */
  stats: (readonly [string, string] | string)[];
  status: { text: string; tone: Tone };
  action?: {
    label: string;
    onClick: () => void;
    variant: 'primary' | 'secondary';
    disabled?: boolean;
  };
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <article className={cx(s.card, selected && s.selected)} onClick={onSelect}>
      <button
        type="button"
        className={s.head}
        aria-pressed={onSelect ? Boolean(selected) : undefined}
        disabled={!onSelect}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.();
        }}
      >
        <span className={s.who}>
          <span className={s.name}>
            {name} {sub && <span className={s.sub}>· {sub}</span>}
          </span>
          <span className={s.route}>{route}</span>
        </span>
        <span className={s.scoreBox}>
          <span className={s.score}>{score}</span>
          <span className={s.scoreLabel}>{scoreLabel}</span>
        </span>
      </button>
      {breakdown.length > 0 && (
        <div className={s.breakdown}>
          {breakdown.map((b, i) => (
            <span key={i} className={s.line}>
              <span className={s.term}>
                {b.label} {b.note && <span className={s.note}>{b.note}</span>}
              </span>
              <span />
              <span className={s.points}>{b.points}</span>
            </span>
          ))}
        </div>
      )}
      <div className={s.stats}>
        {stats.map((st) =>
          typeof st === 'string' ? (
            <span key={st}>{st}</span>
          ) : (
            <span key={st[0]}>
              {st[0]} <b>{st[1]}</b>
            </span>
          ),
        )}
      </div>
      <div className={s.foot}>
        <span className={cx(s.status, toneClass(status.tone))}>{status.text}</span>
        {action && (
          <Button
            variant={action.variant}
            className={s.action}
            disabled={action.disabled}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
          >
            {action.label}
          </Button>
        )}
      </div>
    </article>
  );
}
