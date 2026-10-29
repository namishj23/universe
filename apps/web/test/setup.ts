import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { FakeEventSource } from './helpers';

/** jsdom has no matchMedia; tests set `prefersDark` to choose the system theme. */
export const media = { prefersDark: false, listeners: new Set<() => void>() };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') && media.prefersDark,
    media: query,
    addEventListener: (_: string, fn: () => void) => media.listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => media.listeners.delete(fn),
  }));
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  media.prefersDark = false;
});
