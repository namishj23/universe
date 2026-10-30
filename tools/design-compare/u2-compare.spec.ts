import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { openBuild } from './mocks.ts';
import { blank, boxes, sideBySide } from './pixels.ts';
import { BUILD, PROTOTYPE } from './playwright.config.ts';
import { openPrototype } from './prototype.ts';
import { U2_SCREENS } from './u2/index.ts';

/**
 * U2's quick check: each designed module screen once (1440×900, light, normal, main role).
 * Images and percentages go to docs/sessions/U2-compare/; U3 runs the full matrix.
 * Run: npx playwright test -c tools/design-compare/playwright.config.ts --project=u2
 */
const OUT = new URL('../../docs/sessions/U2-compare/', import.meta.url);
const RESULTS = new URL('results/', OUT);
mkdirSync(RESULTS, { recursive: true });
const viewport = { width: 1440, height: 900 };

for (const s of U2_SCREENS) {
  test(s.name, async ({ browser }) => {
    const context = { viewport, timezoneId: 'Asia/Kolkata', locale: 'en-GB' };
    const protoContext = await browser.newContext(context);
    const proto = await protoContext.newPage();
    await openPrototype(
      proto,
      PROTOTYPE,
      { role: s.role, screen: 'dashboard', state: 'normal', theme: 'light' },
      s.prototype,
    );
    const buildContext = await browser.newContext(context);
    const build = await buildContext.newPage();
    const errors: string[] = [];
    build.on('pageerror', (e) => errors.push(e.message));
    const unhandled = await openBuild(build, BUILD, {
      role: s.role,
      screen: 'dashboard',
      state: 'normal',
      theme: 'light',
      path: s.path,
    });
    if (s.ready) await s.ready(build);
    await build.waitForTimeout(300);

    const shot = { animations: 'disabled', caret: 'hide' } as const;
    const a = PNG.sync.read(await proto.screenshot(shot));
    const b = PNG.sync.read(await build.screenshot(shot));
    const masks = [...(await boxes(proto, s.masks)), ...(await boxes(build, s.masks))];
    blank(a, masks);
    blank(b, masks);
    const diff = new PNG({ width: a.width, height: a.height });
    const pixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const percent = Number(((pixels / (a.width * a.height)) * 100).toFixed(3));
    writeFileSync(new URL(`${s.name}.png`, OUT), sideBySide([a, b, diff]));
    writeFileSync(
      new URL(`${s.name}.json`, RESULTS),
      JSON.stringify({
        name: s.name,
        role: s.role,
        path: s.path,
        pixels,
        percent,
        unhandled,
        errors,
      }),
    );
    console.log(
      `${s.name}: ${percent}%${unhandled.length ? ` unhandled ${unhandled.join(', ')}` : ''}`,
    );
    await protoContext.close();
    await buildContext.close();
  });
}
