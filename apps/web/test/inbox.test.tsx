import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@universe/contracts';
import { F, FakeEventSource, apiError, mockApi, renderApp, signedIn } from './helpers';

const live: ActivityEvent = {
  id: '00000000-0000-4000-8000-000000000999',
  module: 'platform',
  type: 'platform.announcement',
  payload: { message: 'Fire drill at 11:00.' },
  actor: { id: F.USERS.admin.id, name: 'Admin Office' },
  readAt: null,
  createdAt: new Date().toISOString(),
};
const badge = () => screen.getByRole('link', { name: /^Inbox/ });

describe('inbox', () => {
  it('updates the unread badge and the list from the stream, once per event id', async () => {
    mockApi(signedIn('student'));
    await renderApp('/inbox');
    await screen.findByText('Library open until 23:00 through exam week.', { exact: false });
    act(() => FakeEventSource.latest.emit('unread-count', { count: 3 }));
    expect(badge()).toHaveTextContent('3');

    act(() => {
      FakeEventSource.latest.emit('activity', live);
      FakeEventSource.latest.emit('activity', live);
      FakeEventSource.latest.emit('unread-count', { count: 4 });
    });
    expect(screen.getAllByText('announced: Fire drill at 11:00.')).toHaveLength(1);
    expect(badge()).toHaveTextContent('4');
  });

  it('marks all read at once, and rolls back with a toast when the server fails', async () => {
    let fail = true;
    mockApi(
      signedIn('student', {
        'POST /api/activity/read-all': () =>
          fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'down') : { status: 204 },
      }),
    );
    await renderApp('/inbox');
    const list = await screen.findByRole('list', { name: 'Activity' });
    act(() => FakeEventSource.latest.emit('unread-count', { count: 3 }));
    const unread = () => within(list).queryAllByText('Unread:');
    expect(unread()).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't mark everything read.");
    await waitFor(() => expect(unread()).toHaveLength(3));
    expect(badge()).toHaveTextContent('3');

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(unread()).toHaveLength(0);
    expect(badge()).not.toHaveTextContent(/\d/);
  });

  it('shows the announcement card to admins and toasts the recipient count', async () => {
    mockApi(signedIn('admin', { 'POST /api/activity/announcements': { body: { recipients: 7 } } }));
    await renderApp('/inbox');
    const box = await screen.findByRole('textbox', { name: 'ANNOUNCEMENT TO EVERYONE' });
    const send = screen.getByRole('button', { name: 'Send to everyone' });
    expect(send).toBeDisabled();
    await userEvent.type(box, 'Library open late');
    expect(screen.getByText('17 / 500')).toBeInTheDocument();
    await userEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to 7 people.');
  });
});
