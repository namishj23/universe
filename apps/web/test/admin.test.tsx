import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { F, apiError, mockApi, renderApp, signedIn } from './helpers';

const row = (name: string) =>
  screen.getByRole('button', { name }).closest('[role="row"]') as HTMLElement;

describe('admin', () => {
  it('shows a new user’s temporary password once', async () => {
    mockApi(signedIn('admin', { 'POST /api/admin/users': { status: 201, body: F.created } }));
    await renderApp('/admin');
    await screen.findByRole('button', { name: 'Kabir Shah' });
    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a name and a valid email.');
    await userEvent.type(within(dialog).getByLabelText('NAME'), 'Meera Pillai');
    await userEvent.type(within(dialog).getByLabelText('EMAIL'), 'meera.pillai@spit.ac.in');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    const done = await screen.findByRole('dialog', { name: 'User created' });
    expect(done).toHaveTextContent(F.created.temporaryPassword);
    await userEvent.click(within(done).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    await screen.findByRole('dialog', { name: 'New user' });
    expect(document.body).not.toHaveTextContent(F.created.temporaryPassword);
  });

  it('says so when the email is taken (409)', async () => {
    mockApi(
      signedIn('admin', {
        'POST /api/admin/users': apiError(409, 'EMAIL_TAKEN', 'Email already registered'),
      }),
    );
    await renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    await userEvent.type(within(dialog).getByLabelText('NAME'), 'Aarav Again');
    await userEvent.type(within(dialog).getByLabelText('EMAIL'), 'student@universe.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'An account with this email already exists.',
    );
  });

  it.each([
    ['CANNOT_CHANGE_SELF', 'You cannot change your own account here.'],
    ['LAST_ADMIN', 'At least one active admin must remain.'],
  ])('turns %s into a toast', async (code, message) => {
    mockApi(signedIn('admin', { 'PATCH /api/admin/users/:id': apiError(409, code, message) }));
    const routes = signedIn('admin');
    mockApi({
      ...routes,
      [`PATCH /api/admin/users/${F.users().items[5]!.id}`]: apiError(409, code, message),
    });
    await renderApp('/admin');
    await screen.findByRole('button', { name: 'Kabir Shah' });
    await userEvent.click(within(row('Kabir Shah')).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('status')).toHaveTextContent(message);
  });

  it('shows "You" on your own row, disabled', async () => {
    mockApi(signedIn('admin'));
    await renderApp('/admin');
    await screen.findByRole('button', { name: 'Admin Office' });
    expect(within(row('Admin Office')).getByRole('button', { name: 'You' })).toBeDisabled();
  });

  it('sends the search and role filter to the server, debounced', async () => {
    const calls = mockApi(signedIn('admin'));
    await renderApp('/admin');
    await userEvent.type(await screen.findByRole('searchbox'), 'kab');
    await userEvent.click(screen.getByRole('button', { name: 'student' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes('q=kab') && c.path.includes('role=student'))).toBe(
        true,
      ),
    );
    expect(calls.filter((c) => /q=k(&|$)/.test(c.path))).toHaveLength(0);
  });

  it('filters the audit log by action prefix', async () => {
    const calls = mockApi(signedIn('admin'));
    await renderApp('/admin/audit');
    await screen.findByText('auth.login_failed');
    expect(screen.getByText('email hmac 3f9a…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'auth.*' }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('actionPrefix=auth'))).toBe(true));
  });
});
