import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { F, mockApi, renderApp, signedIn } from './helpers';

describe('dashboard', () => {
  it("keeps the page when one module summary fails: that card shows — and Couldn't load", async () => {
    const dash = F.dashboard('student');
    dash.modules = dash.modules.map((m) =>
      m.id === 'rides' ? { id: 'rides', status: 'timeout' } : m,
    );
    mockApi(signedIn('student', { 'GET /api/dashboard': { body: dash } }));
    await renderApp('/');
    const retry = await screen.findByRole('button', { name: "Rides: couldn't load, retry" });
    expect(within(retry).getByText('—')).toBeInTheDocument();
    expect(within(retry).getByText("Couldn't load · retry")).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: /Student Hub/ })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: /Wellbeing/ })).toBeInTheDocument();
  });

  it('renders seven days, with "Nothing yet" on days without items', async () => {
    mockApi(signedIn('student', { 'GET /api/dashboard/week': { body: F.week('student', true) } }));
    await renderApp('/');
    const week = await screen.findByRole('list', { name: 'Your week' });
    const days = within(week).getAllByRole('listitem');
    expect(days).toHaveLength(7);
    for (const day of days) expect(within(day).getByText('Nothing yet')).toBeInTheDocument();
  });

  it('shows dated items with their module code and links to the module', async () => {
    mockApi(signedIn('student'));
    await renderApp('/');
    const item = await screen.findByRole('link', { name: /Ride to SPIT/ });
    expect(item).toHaveAttribute('href', '/rides');
    expect(item).toHaveTextContent('B · 08:10');
    expect(item).toHaveTextContent('● confirmed');
  });
});
