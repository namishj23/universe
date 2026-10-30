import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useUser } from '../../platform/auth';
import { AREA } from '../../shell/modules';
import { ComingSoon } from '../../shell/pages/ModulePage';
import { TabLinks } from '../../shell/ui/Controls';
import { PageHeader } from '../../shell/ui/Page';
import { FindRide } from './Find';
import { Matches } from './Matches';
import { OfferDetail, OfferRide } from './Offer';
import { GroupDetail, Pools } from './Pools';
import { Savings } from './Savings';
import s from './Rides.module.css';

/**
 * Rides (README §5). Students and mentors get the designed tabs (Find a ride · Matches · Offer
 * a ride), then Auto pools and Savings. Tabs are routes under /rides; the week strip
 * deep-links into offers, groups and matches. Driver and admin screens come in a later build.
 */
export default function Page() {
  const role = useUser().role;
  // The last ride request found this visit, so the Matches and Auto pools tabs keep it.
  const [requestId, setRequestId] = useState<string | null>(null);
  if (role === 'driver' || role === 'admin') return <ComingSoon id="rides" />;
  const withRequest = (path: string) => (requestId ? `${path}?requestId=${requestId}` : path);
  return (
    <div data-mod="rides" className={s.page}>
      <PageHeader
        eyebrow={AREA.rides.eyebrow}
        title={AREA.rides.title}
        module="rides"
        action={<span className={s.rule}>MATCH ≥ 50% OVERLAP · ±10 MIN · MAX 3 RIDERS</span>}
      >
        <TabLinks
          label="Rides sections"
          tabs={[
            { to: '/rides', label: 'Find a ride' },
            { to: withRequest('/rides/matches'), label: 'Matches' },
            { to: '/rides/offer', label: 'Offer a ride' },
            { to: withRequest('/rides/pools'), label: 'Auto pools' },
            { to: '/rides/savings', label: 'Savings' },
          ]}
        />
      </PageHeader>
      <Routes>
        <Route index element={<FindRide />} />
        <Route path="matches" element={<Matches onRequest={setRequestId} />} />
        <Route path="offer" element={<OfferRide />} />
        <Route path="offers/:id" element={<OfferDetail />} />
        <Route path="pools" element={<Pools />} />
        <Route path="groups/:id" element={<GroupDetail />} />
        <Route path="savings" element={<Savings />} />
        <Route path="*" element={<Navigate to="/rides" replace />} />
      </Routes>
    </div>
  );
}
