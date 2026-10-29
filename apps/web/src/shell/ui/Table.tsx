import type { CSSProperties, ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import s from './Table.module.css';

type Vars = CSSProperties & Record<`--${string}`, string>;

/**
 * A bordered table card built from CSS grid rows. `columns` is the grid template shared by the
 * header and every row; `minWidth` is where it starts scrolling inside the card.
 */
export function Table({
  label,
  columns,
  headers,
  minWidth,
  rowPad,
  align,
  children,
}: {
  label: string;
  columns: string;
  headers: ReactNode[];
  minWidth?: string;
  rowPad?: string;
  align?: 'center' | 'baseline';
  children: ReactNode;
}) {
  const vars: Vars = {
    '--cols': columns,
    ...(minWidth && { '--table-min': minWidth }),
    ...(rowPad && { '--row-pad': rowPad }),
    ...(align && { '--row-align': align }),
  };
  return (
    <div className={cx(s.card, s.scroll)} style={vars} role="table" aria-label={label}>
      <div className={s.head} role="row">
        {headers.map((h, i) => (
          <span key={i} role="columnheader">
            {h}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

export function Row({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div role="row" className={cx(s.row, className)} style={style}>
      {children}
    </div>
  );
}

/** A note inside the table card ("No users match this search."). */
export function TableNote({ children }: { children: ReactNode }) {
  return <div className={s.note}>{children}</div>;
}

/** Cursor paging: a button, never infinite scroll. */
export function LoadMore({
  hasMore,
  loading,
  onClick,
  label = 'Load more',
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
  label?: string;
}) {
  if (!hasMore) return null;
  return (
    <Button variant="secondary" className={s.more} disabled={loading} onClick={onClick}>
      {loading ? 'Loading…' : label}
    </Button>
  );
}

export const tableStyles = s;
