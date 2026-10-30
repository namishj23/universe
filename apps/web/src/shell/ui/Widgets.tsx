import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import s from './Widgets.module.css';

/** The design's card: 1.5px border, radius 8, `--surface`, padding 14px (`pad` 12–18). */
export function Card({
  children,
  pad = 14,
  gap = 8,
  dashed,
  className,
  ...rest
}: {
  children: ReactNode;
  pad?: 12 | 14 | 16 | 18;
  gap?: 6 | 8 | 10 | 12 | 14;
  dashed?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'className'>) {
  return (
    <section
      {...rest}
      className={cx(s.card, s[`pad${pad}`], s[`gap${gap}`], dashed && s.dashed, className)}
    >
      {children}
    </section>
  );
}

/** Mono 11/600 card label ("OVERALL", "TODAY · DAILY TOTALS"); `meta` sits on the right. */
export function CardLabel({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  if (meta === undefined) return <h2 className={s.label}>{children}</h2>;
  return (
    <div className={s.labelRow}>
      <h2 className={s.label}>{children}</h2>
      <span className={s.labelMeta}>{meta}</span>
    </div>
  );
}

/**
 * 34×20 toggle (`role="switch"`): on = module hue fill (`data-mod` on an ancestor), off =
 * `--line-strong`, 16px `--raised` knob. The label is the visible text on the left.
 */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={s.switch}
      onClick={() => onChange(!checked)}
    >
      {label}
      <span className={cx(s.track, checked && s.on)} aria-hidden="true">
        <span className={s.knob} />
      </span>
    </button>
  );
}

/** The SEATS stepper: − value +, 38px, each button labelled for screen readers. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div role="group" aria-label={label} className={s.stepper}>
      <button
        type="button"
        aria-label={`One fewer: ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output aria-live="polite" className={s.stepValue}>
        {value}
      </output>
      <button
        type="button"
        aria-label={`One more: ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

/** 8px progress bar, radius 2, `--line` track, module fill (`data-mod` on an ancestor). */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <span
      className={s.bar}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className={s.barFill} style={{ width: `${p}%` }} />
    </span>
  );
}

/** The weekly goal: one 16px cell per item (done cells in the module fill). */
export function GoalGrid({ done, total }: { done: number; total: number }) {
  return (
    <div
      className={s.goal}
      style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}
      role="img"
      aria-label={`${done} of ${total} done`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx(s.cell, i < done && s.cellDone)} />
      ))}
    </div>
  );
}

export interface Bar {
  key: string;
  /** Value above the bar (mono 10px), e.g. "4.2". */
  value: string;
  /** Label below (mono 10.5/600), e.g. "M". */
  label: string;
  /** 0–1 of the chart height. */
  ratio: number;
  highlight?: boolean;
}

/**
 * Wellbeing's LAST 7 DAYS chart: bars 3px-rounded on top, highlighted in the module fill,
 * others `--line-strong`. `summary` is the text alternative for screen readers.
 */
export function BarChart({
  bars,
  height = 170,
  summary,
}: {
  bars: Bar[];
  height?: 150 | 170;
  summary: string;
}) {
  return (
    <figure className={s.chartFigure}>
      <div className={cx(s.chart, height === 150 ? s.h150 : s.h170)} aria-hidden="true">
        {bars.map((b) => (
          <div key={b.key} className={s.col}>
            <span className={s.colValue}>{b.value}</span>
            <div
              className={cx(s.colBar, b.highlight && s.colBarOn)}
              style={{ height: `${Math.max(0, Math.min(1, b.ratio)) * 100}%` }}
            />
            <span className={s.colLabel}>{b.label}</span>
          </div>
        ))}
      </div>
      <figcaption className="uv-visually-hidden">{summary}</figcaption>
    </figure>
  );
}

/** Observatory's KPI card: muted mono label, mono 30 value with a muted unit, a note. */
export function KpiCard({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: ReactNode;
}) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={s.kpiValue}>
        {value}
        {unit && <span className={s.kpiUnit}> {unit}</span>}
      </span>
      {note !== undefined && <span className={s.kpiNote}>{note}</span>}
    </div>
  );
}
