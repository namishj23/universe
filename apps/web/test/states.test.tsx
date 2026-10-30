import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { F, apiError, mockApi, renderApp, signedIn } from './helpers';

describe('shared states', () => {
  it('loading sets aria-busy and names what is loading', async () => {
    mockApi(signedIn('admin', { 'GET /api/admin/users': () => new Promise(() => undefined) }));
    await renderApp('/admin');
    const panel = await screen.findByText('LOADING USERS…');
    expect(panel.closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('error shows the request ID, and Try again refetches', async () => {
    let fail = true;
    mockApi(
      signedIn('student', {
        'GET /api/activity': () =>
          fail ? apiError(400, 'BAD_CURSOR', 'Bad cursor') : { body: F.feed('student') },
      }),
    );
    await renderApp('/inbox');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ERROR · 400 BAD REQUEST');
    expect(alert).toHaveTextContent("Couldn't load your inbox.");
    expect(alert).toHaveTextContent('request_id req-test-1234');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText(/Library open until 23:00/)).toBeInTheDocument();
  });

  it('empty shows the design’s box', async () => {
    mockApi(signedIn('student', { 'GET /api/activity': { body: F.feed('student', true) } }));
    await renderApp('/inbox');
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
  });

  it('a page outside the role is 403, an unknown one 404', async () => {
    mockApi(signedIn('student'));
    const { unmount } = await renderApp('/admin');
    expect(
      await screen.findByRole('heading', { name: 'Not available to you' }),
    ).toBeInTheDocument();
    unmount();
    const second = await renderApp('/exam');
    expect(
      await screen.findByRole('heading', { name: 'Not available to you' }),
    ).toBeInTheDocument();
    second.unmount();
    await renderApp('/nowhere/at/all');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('a listed module without a folder shows the placeholder', async () => {
    mockApi(signedIn('student'));
    await renderApp('/observatory');
    expect(await screen.findByRole('heading', { name: 'Observatory' })).toBeInTheDocument();
    expect(await screen.findByText('Coming in the next build')).toBeInTheDocument();
  });

  it('a module chunk that fails to download asks for a reload', async () => {
    const { isChunkError } = await import('../src/shell/pages/Errors');
    expect(
      isChunkError(new TypeError('Failed to fetch dynamically imported module: /assets/Page-x.js')),
    ).toBe(true);
    expect(isChunkError(new Error('boom'))).toBe(false);
  });
});
