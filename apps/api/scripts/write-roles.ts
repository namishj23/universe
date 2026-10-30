// `npm run docs:roles`: writes docs/ROLES.md from the guards on every mounted route. The
// route-guard test fails while the committed file is out of date.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp, type MountedRouter } from '../src/app.js';
import { loadModules } from '../src/platform/modules/index.js';
import { rolesMarkdown } from '../src/platform/routeTable.js';

const modules = await loadModules();
const mounted = createApp({ modules }).locals.mounted as MountedRouter[];
const target = new URL('../../../docs/ROLES.md', import.meta.url);
writeFileSync(target, `${rolesMarkdown(mounted, modules)}\n`);
console.log(`Wrote ${fileURLToPath(target)}`);
