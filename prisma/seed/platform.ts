import type { Role } from '@universe/contracts';
import { recordActivity } from '../../apps/api/src/platform/activity/service.js';
import { hashPassword } from '../../apps/api/src/platform/auth/password.js';
import { emailHmac } from '../../apps/api/src/platform/auth/throttle.js';
import type { Db } from '../../apps/api/src/platform/db.js';

// The .test domain is reserved (RFC 2606), so these can never be real addresses.
export const DEMO_ACCOUNTS: readonly { email: string; name: string; role: Role }[] = [
  { email: 'student@universe.test', name: 'Aarav Mehta', role: 'student' },
  { email: 'student2@universe.test', name: 'Diya Kulkarni', role: 'student' },
  { email: 'mentor@universe.test', name: 'Prof. Neha Iyer', role: 'mentor' },
  { email: 'invigilator@universe.test', name: 'Rohan Desai', role: 'invigilator' },
  { email: 'admin@universe.test', name: 'Admin Office', role: 'admin' },
  // Student Hub (P4): the design's mentors and the students in its sample data.
  { email: 'sameer.joshi@universe.test', name: 'Dr. Sameer Joshi', role: 'mentor' },
  { email: 'kavita.nair@universe.test', name: 'Prof. Kavita Nair', role: 'mentor' },
  { email: 'arjun.menon@universe.test', name: 'Prof. Arjun Menon', role: 'mentor' },
  { email: 'kabir.shah@universe.test', name: 'Kabir Shah', role: 'student' },
  { email: 'ishita.rao@universe.test', name: 'Ishita Rao', role: 'student' },
  { email: 'sneha.patil@universe.test', name: 'Sneha Patil', role: 'student' },
  { email: 'rahul.verma@universe.test', name: 'Rahul Verma', role: 'student' },
  // Drivers: the rides roster (apps/api/src/modules/rides/data/roster.js, same names) plus two
  // accounts that show the document states. The rides seed links each to its vehicle.
  ...[
    'Ramesh Patil',
    'Sunil Yadav',
    'Anil Gaikwad',
    'Mahesh Shinde',
    'Vijay Kadam',
    'Sunita Jadhav',
    'Priya More',
    'Kiran Pawar',
    'Ganesh Salunkhe',
  ].map((name) => ({
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@drivers.universe.test`,
    name,
    role: 'driver' as const,
  })),
];

/**
 * Idempotent: upserts by email, clears any sign-in lockout, and adds one welcome announcement
 * to an account that has none.
 */
export async function seedPlatform(db: Db, password: string): Promise<void> {
  await db.loginThrottle.deleteMany({
    where: { keyHash: { in: DEMO_ACCOUNTS.map((a) => emailHmac(a.email)) } },
  });
  for (const account of DEMO_ACCOUNTS) {
    const passwordHash = await hashPassword(password);
    const user = await db.user.upsert({
      where: { email: account.email },
      create: { ...account, passwordHash },
      update: { ...account, passwordHash, isActive: true, mustChangePassword: false },
    });
    const announcements = await db.activityEvent.count({
      where: { recipientId: user.id, type: 'platform.announcement' },
    });
    if (announcements === 0) {
      await recordActivity(db, {
        recipients: user.id,
        module: 'platform',
        type: 'platform.announcement',
        payload: { message: `Welcome to UniVerse, ${account.name}! Your activity appears here.` },
      });
    }
  }
}
