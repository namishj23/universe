import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PREP_VIEW } from '../../../tools/design-compare/u2/hub.ts';
import { FakeEventSource, mockApi, renderApp, signedIn } from './helpers';

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

it('+1 sends a new Idempotency-Key (UUID) on every click', async () => {
  const keys: (string | null)[] = [];
  const topic = PREP_VIEW.tracks[0]!.topics[0]!;
  mockApi(
    signedIn('student', {
      'GET /api/hub/prep': { body: PREP_VIEW },
      [`POST /api/hub/prep/${topic.topicId}/increment`]: (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        return {
          body: {
            topic: { ...topic, solved: topic.solved + 1 },
            dsa: PREP_VIEW.dsa,
            week: PREP_VIEW.week,
          },
        };
      },
    }),
  );
  await renderApp('/hub/prep');
  const button = await screen.findByRole('button', { name: `Add one solved: ${topic.name}` });
  await userEvent.click(button);
  await waitFor(() => expect(keys).toHaveLength(1));
  await userEvent.click(button);
  await waitFor(() => expect(keys).toHaveLength(2));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  expect(keys[0]).toMatch(uuid);
  expect(keys[1]).toMatch(uuid);
  expect(keys[0]).not.toBe(keys[1]);
});
