import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderApp, signedIn } from './helpers';

describe('modal and drawer', () => {
  it('the modal traps focus, closes on Esc and returns focus', async () => {
    mockApi(signedIn('admin'));
    await renderApp('/admin');
    const opener = await screen.findByRole('button', { name: 'New user' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('the menu drawer traps focus, closes on Esc and returns focus', async () => {
    mockApi(signedIn('student'));
    await renderApp('/');
    const opener = await screen.findByRole('button', { name: 'Menu' });
    await userEvent.click(opener);
    const drawer = await screen.findByRole('dialog', { name: 'Menu' });
    expect(within(drawer).getByRole('link', { name: /^Inbox/ })).toBeInTheDocument();
    for (let i = 0; i < 10; i++) {
      await userEvent.tab();
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
