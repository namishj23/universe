import { prisma } from '../../apps/api/src/platform/db.js';
import { loadModules, seedModules } from '../../apps/api/src/platform/modules/index.js';
import { seedPlatform } from './platform.js';
import { seedStory } from './story.js';

/** The whole demo seed: platform accounts, every module (in `seedAfter` order), the story. */
export async function runSeed(password: string, log: (line: string) => void = () => {}) {
  const startedAt = new Date();
  await seedPlatform(prisma, password);
  await seedModules(await loadModules(), (id) => log(`Seeded ${id}.`));
  await seedStory(prisma, startedAt);
}
