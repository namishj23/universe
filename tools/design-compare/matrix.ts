import { ROLES, type DemoRole } from './fixtures/index.ts';
import type { Screen, State, Theme } from './mocks.ts';

export interface Case {
  name: string;
  screen: Screen;
  role: DemoRole | null;
  state: State;
  theme: Theme;
  viewport: { width: number; height: number };
}

const STATES: State[] = ['normal', 'loading', 'empty', 'error'];
/** Each U1 screen, the roles the design shows it for, and the states its prototype supports. */
const SCREENS: { screen: Screen; roles: (DemoRole | null)[]; states: State[] }[] = [
  { screen: 'login', roles: [null], states: ['normal', 'error'] },
  { screen: 'dashboard', roles: ROLES, states: STATES },
  { screen: 'inbox', roles: ROLES, states: STATES },
  { screen: 'admin-users', roles: ['admin'], states: STATES },
  { screen: 'admin-audit', roles: ['admin'], states: STATES },
];
export const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const THEMES: Theme[] = ['light', 'dark'];

export const CASES: Case[] = SCREENS.flatMap(({ screen, roles, states }) =>
  roles.flatMap((role) =>
    states.flatMap((state) =>
      THEMES.flatMap((theme) =>
        VIEWPORTS.map((viewport) => ({
          name: [screen, role, state, theme, viewport.width].filter(Boolean).join('-'),
          screen,
          role,
          state,
          theme,
          viewport,
        })),
      ),
    ),
  ),
);
