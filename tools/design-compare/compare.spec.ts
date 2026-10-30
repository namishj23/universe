import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { blank, boxes, sideBySide } from './pixels.ts';
import { CASES } from './matrix.ts';
import { openBuild } from './mocks.ts';
import { BUILD, PROTOTYPE } from './playwright.config.ts';
import { openPrototype } from './prototype.ts';

/** Prototype vs build, pixel for pixel (masks in pixels.ts). */
const OUT = new URL('../../docs/sessions/U1-compare/', import.meta.url);
const RESULTS = new URL('results/', OUT);
mkdirSync(RESULTS, { recursive: true });

for (const c of CASES) {
  test(c.name, async ({ browser }) => {
    const context = { viewport: c.viewport, timezoneId: 'Asia/Kolkata', locale: 'en-GB' };
    const protoContext = await browser.newContext(context);
    const proto = await protoContext.newPage();
    await openPrototype(proto, PROTOTYPE, c);
    const buildContext = await browser.newContext(context);
    const build = await buildContext.newPage();
    const unhandled = await openBuild(build, BUILD, c);

    const shot = { animations: 'disabled', caret: 'hide' } as const;
    const a = PNG.sync.read(await proto.screenshot(shot));
    const b = PNG.sync.read(await build.screenshot(shot));
    const masks = [...(await boxes(proto)), ...(await boxes(build))];
    blank(a, masks);
    blank(b, masks);
    const diff = new PNG({ width: a.width, height: a.height });
    const pixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const percent = (pixels / (a.width * a.height)) * 100;

    writeFileSync(new URL(`${c.name}.png`, OUT), sideBySide([a, b, diff]));
    writeFileSync(
      new URL(`${c.name}.json`, RESULTS),
      JSON.stringify({ ...c, pixels, percent: Number(percent.toFixed(3)), unhandled }),
    );
    await protoContext.close();
    await buildContext.close();
  });
}
