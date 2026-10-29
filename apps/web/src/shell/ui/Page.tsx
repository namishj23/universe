import { useEffect, type ReactNode } from 'react';
import { cx } from './cx';
import s from './Page.module.css';

export type Tone = 'ok' | 'warn' | 'neutral' | 'err';
export const toneClass = (tone: Tone | undefined) => (tone ? s[tone] : undefined);

/** Sets the tab title: "Inbox · UniVerse". */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · UniVerse`;
  }, [title]);
}

/**
 * Every screen starts with this: a mono eyebrow (in the module hue when `module` is set), the
 * h1, and an optional action on the right. The h1 receives focus after navigation.
 */
export function PageHeader({
  eyebrow,
  title,
  module,
  action,
  baseline,
  children,
}: {
  eyebrow: string;
  title: string;
  module?: string;
  action?: ReactNode;
  baseline?: boolean;
  children?: ReactNode;
}) {
  usePageTitle(title);
  return (
    <>
      <div className={cx(s.header, baseline && s.baseline)} data-mod={module}>
        <div className={s.titles}>
          <span className={cx(s.eyebrow, module && s.eyebrowHue)}>{eyebrow}</span>
          <h1 className={s.h1} tabIndex={-1} data-page-heading="">
            {title}
          </h1>
        </div>
        {action}
      </div>
      {children}
    </>
  );
}

/** Mono meta text for the right side of a header. */
export function HeaderMeta({ children }: { children: ReactNode }) {
  return <span className={s.meta}>{children}</span>;
}

/** The 22×22 code tile in the module fill. */
export function CodeTile({ module, code }: { module: string; code: string }) {
  return (
    <span className={s.tile} data-mod={module} aria-hidden="true">
      {code}
    </span>
  );
}

/** A 7px status dot in a status colour, with its meaning as text for screen readers. */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={toneClass(tone)}>
      <span className={s.dot} aria-hidden="true" />
      <span className="uv-visually-hidden">{label}</span>
    </span>
  );
}
