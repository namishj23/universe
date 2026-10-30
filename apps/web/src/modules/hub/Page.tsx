import type { ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import type { Role } from '@universe/contracts';
import { useUser } from '../../platform/auth';
import { AREA } from '../../shell/modules';
import { TabLinks } from '../../shell/ui/Controls';
import { PageHeader } from '../../shell/ui/Page';
import { MentorRequests, Slots } from './MentorTabs';
import { Mentors } from './Mentors';
import { Prep } from './Prep';
import { Profile } from './Profile';
import { Ranking } from './Ranking';
import { Resources } from './Resources';
import s from './Hub.module.css';

type Tab = 'prep' | 'mentors' | 'requests' | 'slots' | 'resources' | 'profile' | 'ranking';
const LABEL: Record<Tab, string> = {
  prep: 'Prep tracker',
  mentors: 'Mentors',
  requests: 'Requests',
  slots: 'Slots',
  resources: 'Resources',
  profile: 'Profile',
  ranking: 'Mentor ranking',
};
/** The design's tabs per role; mentor "Slots" is not drawn and comes after the designed ones. */
const TABS: Partial<Record<Role, Tab[]>> = {
  student: ['prep', 'mentors', 'resources', 'profile'],
  mentor: ['requests', 'resources', 'profile', 'slots'],
  admin: ['resources', 'ranking'],
};
const SCREENS: Record<Tab, ComponentType> = {
  prep: Prep,
  mentors: Mentors,
  requests: MentorRequests,
  slots: Slots,
  resources: Resources,
  profile: Profile,
  ranking: Ranking,
};

/** `/hub/*`: the Student Hub. Every tab is a route; a tab the role doesn't have goes to its first. */
export default function Page() {
  const user = useUser();
  const tabs = TABS[user.role] ?? [];
  const first = tabs[0] ?? 'resources';
  return (
    <>
      <PageHeader eyebrow={AREA.hub.eyebrow} title={AREA.hub.title} module="hub">
        <TabLinks
          label="Student Hub sections"
          tabs={tabs.map((t) => ({ to: `/hub/${t}`, label: LABEL[t] }))}
        />
      </PageHeader>
      <div data-mod="hub" className={s.hue}>
        <Routes>
          {tabs.map((t) => {
            const Screen = SCREENS[t];
            return <Route key={t} path={t} element={<Screen />} />;
          })}
          <Route path="*" element={<Navigate to={`/hub/${first}`} replace />} />
        </Routes>
      </div>
    </>
  );
}
