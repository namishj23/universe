// `npm run api:docs`: writes the OpenAPI document for the platform and every module to
// docs/api/openapi.json. The OpenAPI test fails while the committed file is out of date.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModules } from '../src/platform/modules/index.js';
import { buildOpenApiDocument } from '../src/platform/openapi.js';

const target = new URL('../../../docs/api/openapi.json', import.meta.url);
mkdirSync(new URL('.', target), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(await loadModules()), null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(target)}`);
