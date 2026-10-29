import { Component, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { PageHeader } from '../ui/Page';
import { Empty, ErrorBox } from '../ui/States';
import s from './Errors.module.css';

/** A lazily loaded page whose file is gone: the app was redeployed under the user. */
export const isChunkError = (error: unknown) =>
  error instanceof Error &&
  /dynamically imported module|Importing a module script failed|module script/i.test(error.message);

const reload = () => window.location.reload();

export function NotFound() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <PageHeader eyebrow="ERROR · 404" title="Page not found">
      <Empty
        label="NOT FOUND"
        title="Nothing at this address"
        body={`There is no page at ${pathname}. Check the address, or go back to your dashboard.`}
        action={{ label: 'Go to dashboard', onClick: () => void navigate('/') }}
      />
    </PageHeader>
  );
}

export function Forbidden() {
  const navigate = useNavigate();
  return (
    <PageHeader eyebrow="ERROR · 403" title="Not available to you">
      <Empty
        label="FORBIDDEN"
        title="Your role can't open this page"
        body="This part of UniVerse is for other roles. If you think you should have access, ask the admin office."
        action={{ label: 'Go to dashboard', onClick: () => void navigate('/') }}
      />
    </PageHeader>
  );
}

export function NewVersion() {
  return (
    <PageHeader eyebrow="UPDATE" title="A new version is available">
      <Empty
        label="NEW VERSION"
        title="Reload to continue"
        body="UniVerse was updated while this tab was open, so this page can't load. Reload to get the new version. Nothing you saved is lost."
        action={{ label: 'Reload', onClick: reload }}
      />
    </PageHeader>
  );
}

/** "Something went wrong", with the request ID when the failure came from the API. */
export function SomethingWrong({ error, inline }: { error: unknown; inline?: boolean }) {
  const box = (
    <ErrorBox
      error={error}
      title="Something went wrong."
      body="UniVerse hit a problem it couldn't recover from. Reload the page, or quote this request ID if it keeps happening."
      onRetry={reload}
      retryLabel="Reload"
    />
  );
  if (inline)
    return (
      <PageHeader eyebrow="ERROR" title="Something went wrong">
        {box}
      </PageHeader>
    );
  return (
    <main className={s.page}>
      <PageHeader eyebrow="ERROR" title="Something went wrong">
        {box}
      </PageHeader>
    </main>
  );
}

/** The outermost boundary: anything that escapes every page. */
export class AppBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (isChunkError(error))
      return (
        <main className={s.page}>
          <NewVersion />
        </main>
      );
    return <SomethingWrong error={error} />;
  }
}
