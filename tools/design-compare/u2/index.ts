import type { Page } from '@playwright/test';
import type { DemoRole } from '../fixtures/index.ts';
import hub from './hub.ts';
import rides from './rides.ts';
import wellbeing from './wellbeing.ts';

/**
 * U2's quick prototype-vs-build check: one case per designed module screen at 1440×900, light
 * theme, normal state, for its main role (U3 runs the full matrix). Each module file owns its
 * route mocks (built from the prototype's sample data, parsed with the contracts) and how to
 * reach the screen in the prototype.
 */
export interface U2Screen {
  /** e.g. 'hub-prep' (file name in docs/sessions/U2-compare/). */
  name: string;
  role: DemoRole;
  /** Build route, e.g. '/hub/prep'. */
  path: string;
  /** Drives the prototype (already signed in as `role`) to the same screen. */
  prototype: (page: Page) => Promise<void>;
  /** Optional: wait for something in the build before the screenshot (data loaded). */
  ready?: (page: Page) => Promise<void>;
  /** Extra selectors blanked in both images (undrawn sections inside the viewport). */
  masks?: string[];
}

export interface U2Module {
  screens: U2Screen[];
  /** Answers an /api/* call for this module, or undefined when it isn't one of its paths. */
  respond: (
    role: DemoRole,
    method: string,
    url: URL,
    body: unknown,
  ) => { body: unknown; status?: number } | undefined;
}

const MODULES: U2Module[] = [hub, rides, wellbeing];
export const U2_SCREENS = MODULES.flatMap((m) => m.screens);
export const respondU2: U2Module['respond'] = (...args) => {
  for (const m of MODULES) {
    const r = m.respond(...args);
    if (r) return r;
  }
  return undefined;
};
