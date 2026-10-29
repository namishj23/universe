import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { useParams } from 'react-router';
import { ModuleId } from '@universe/contracts';
import { useModules } from '../layout/AppShell';
import { AREA, modulePages } from '../modules';
import { PageHeader } from '../ui/Page';
import { Empty, ErrorBox, Loading } from '../ui/States';
import { Forbidden, NotFound } from './Errors';

// One lazy component per module, created once so React keeps its state between renders.
const lazyPages = new Map<string, LazyExoticComponent<ComponentType>>();
const pageFor = (id: string) => {
  const load = modulePages[id];
  if (!load) return null;
  let page = lazyPages.get(id);
  if (!page) {
    page = lazy(load);
    lazyPages.set(id, page);
  }
  return page;
};

/** The design's placeholder for a module whose screens arrive in a later build. */
export function ComingSoon({ id }: { id: ModuleId }) {
  const area = AREA[id];
  return (
    <PageHeader eyebrow={area.eyebrow} title={area.title} module={id}>
      <Empty
        title="Coming in the next build"
        body="This module's screens are being built. Its data and API already work, and it will open here."
      />
    </PageHeader>
  );
}

/**
 * `/<module id>/*`: only modules `GET /api/modules` lists for this role open (403 for the
 * others, 404 for unknown paths). Screens come from `apps/web/src/modules/<id>/Page.tsx`.
 */
export function ModuleRoute() {
  const { moduleId = '' } = useParams();
  const modules = useModules();
  const parsed = ModuleId.safeParse(moduleId);
  if (!parsed.success) return <NotFound />;
  const area = AREA[parsed.data];
  if (modules.isPending)
    return (
      <PageHeader eyebrow={area.eyebrow} title={area.title} module={parsed.data}>
        <Loading what={area.label} />
      </PageHeader>
    );
  if (modules.isError)
    return (
      <PageHeader eyebrow={area.eyebrow} title={area.title} module={parsed.data}>
        <ErrorBox error={modules.error} what={area.label} onRetry={() => void modules.refetch()} />
      </PageHeader>
    );
  if (!modules.data.some((m) => m.id === parsed.data)) return <Forbidden />;
  const Page = pageFor(parsed.data);
  return Page ? <Page /> : <ComingSoon id={parsed.data} />;
}
