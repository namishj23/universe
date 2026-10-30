import type { ComponentType } from 'react';
import type { ActivityEvent, ModuleId, PublicUser } from '@universe/contracts';
import type { Tone } from './ui/Page';

/** A dashboard card's body, from the module's own summary. */
export interface CardContent {
  big: string;
  text: string;
  status?: string;
  tone?: Tone;
}

/**
 * What a module's web folder tells the shell, from `apps/web/src/modules/<id>/module.ts`
 * (loaded with the shell, so keep it small). Its screens live in `Page.tsx`, loaded lazily.
 */
export interface WebModule {
  /**
   * Plain-text inbox wording per activity type. Start with a lower-case verb to follow the
   * actor's name ("accepted you on…"); a capitalised sentence is shown on its own.
   */
  activityText?: Record<string, (payload: unknown, event: ActivityEvent) => string>;
  /** The dashboard card for this module's summary data; null shows the placeholder card. */
  dashboardCard?: (data: unknown, user: PublicUser) => CardContent | null;
  /**
   * Live updates: the query keys to invalidate when a stored activity event of this type
   * arrives on the stream (`ActivityProvider`). Keys start with the module id.
   */
  invalidates?: Partial<Record<string, readonly (readonly unknown[])[]>>;
}

type Area = ModuleId | 'admin' | 'platform';
/** Code letters, header copy and hues are design facts per id; which modules show is the API's. */
export const AREA: Record<Area, { code: string; label: string; eyebrow: string; title: string }> = {
  hub: {
    code: 'A',
    label: 'Student Hub',
    eyebrow: 'A · STUDENT INTELLIGENCE AND ACADEMIC HUB',
    title: 'Student Hub',
  },
  rides: { code: 'B', label: 'Rides', eyebrow: 'B · SMART CAMPUS RIDE-POOLING', title: 'Rides' },
  observatory: {
    code: 'C',
    label: 'Observatory',
    eyebrow: 'C · SUSTAINABLE COMPUTING OBSERVATORY',
    title: 'Observatory',
  },
  wellbeing: {
    code: 'C',
    label: 'Wellbeing',
    eyebrow: 'C · PRIVACY-AWARE DIGITAL WELLBEING',
    title: 'Wellbeing',
  },
  exam: {
    code: 'E',
    label: 'Exam Review',
    eyebrow: 'E · RESPONSIBLE EXAMINATION MONITORING',
    title: 'Flag review',
  },
  admin: { code: '§', label: 'Admin', eyebrow: 'PLATFORM · ADMIN', title: 'Admin' },
  platform: { code: '—', label: 'Platform', eyebrow: 'PLATFORM', title: 'Platform' },
};

const id = (path: string) => /\/modules\/([^/]+)\//.exec(path)?.[1] ?? '';

// Discovered by folder: adding apps/web/src/modules/<id>/ needs no change to the shell.
const meta = import.meta.glob<{ default: WebModule }>('../modules/*/module.ts', { eager: true });
const pages = import.meta.glob<{ default: ComponentType }>('../modules/*/Page.tsx');

export const webModules: Partial<Record<string, WebModule>> = Object.fromEntries(
  Object.entries(meta).map(([path, mod]) => [id(path), mod.default]),
);
export const modulePages: Partial<Record<string, () => Promise<{ default: ComponentType }>>> =
  Object.fromEntries(Object.entries(pages).map(([path, load]) => [id(path), load]));
