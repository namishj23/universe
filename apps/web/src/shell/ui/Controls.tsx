import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import s from './Controls.module.css';
import { cx } from './cx';

export interface Choice<T extends string> {
  id: T;
  label: ReactNode;
}

/**
 * A row of filter chips; exactly one is active (`aria-pressed`). `look`: pill (13px), mono
 * pill (11.5px mono) or square (38px tall, next to a search input).
 */
export function Chips<T extends string>({
  label,
  choices,
  value,
  onChange,
  look = 'pill',
  tight,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (id: T) => void;
  look?: 'pill' | 'mono' | 'square';
  tight?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cx(s.chips, tight && s.chipsTight)}>
      {choices.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={c.id === value}
          className={cx(
            s.chip,
            look !== 'pill' && s.mono,
            look === 'square' && s.square,
            c.id === value && s.active,
          )}
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** One bordered group of mono buttons (the Observatory range picker). */
export function Segmented<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={s.segmented}>
      {choices.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={c.id === value}
          className={cx(s.segment, c.id === value && s.active)}
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Tabs that are routes: the active one has the 3px ink bar and `aria-current="page"`. */
export function TabLinks({
  label,
  tabs,
}: {
  label: string;
  tabs: { to: string; label: string }[];
}) {
  return (
    <nav aria-label={label} className={s.tabs}>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) => cx(s.tab, isActive && s.tabActive)}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
