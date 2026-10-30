import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { CASES } from './matrix.ts';
import { openBuild } from './mocks.ts';
import { BUILD, PROTOTYPE } from './playwright.config.ts';
import { openPrototype } from './prototype.ts';

/**
 * Prototype vs build, pixel for pixel. Masked (blanked in both images) are only the regions
 * that differ on purpose: request IDs, the prototype's "Any password works…" demo note and its
 * "viewing as" role switcher, which the build replaces with the account menu.
 */
const OUT = new URL('../../docs/sessions/U1-compare/', import.meta.url);
const RESULTS = new URL('results/', OUT);
mkdirSync(RESULTS, { recursive: true });

type Box = { x: number; y: number; width: number; height: number };
const MASKS = [
  // Request IDs: the error box line and the audit REQUEST column.
  'text=/^request_id /',
  '[data-request-id]',
  'text=/^req_[0-9a-f]{6}$/',
  // Demo-only regions.
  'text=/^Any password works/',
  '[data-demo-note]',
  'button:has-text("viewing as")',
  'aside button[aria-haspopup="menu"]',
];
async function boxes(page: Page) {
  const found: Box[] = [];
  for (const selector of MASKS)
    for (const el of await page.locator(selector).all()) {
      const b = await el.boundingBox();
      if (b) found.push(b);
    }
  return found;
}
function blank(png: PNG, all: Box[]) {
  for (const b of all)
    for (
      let y = Math.max(0, Math.floor(b.y));
      y < Math.min(png.height, Math.ceil(b.y + b.height));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(b.x));
        x < Math.min(png.width, Math.ceil(b.x + b.width));
        x++
      ) {
        const i = (y * png.width + x) * 4;
        png.data[i] = 255;
        png.data[i + 1] = 0;
        png.data[i + 2] = 255;
        png.data[i + 3] = 255;
      }
}
/** Prototype | build | diff, at half size, to keep the committed images small. */
function sideBySide(images: PNG[]) {
  const w = images[0]!.width;
  const h = images[0]!.height;
  const out = new PNG({ width: Math.ceil((w * images.length) / 2), height: Math.ceil(h / 2) });
  images.forEach((img, k) => {
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < Math.ceil(w / 2); x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          let n = 0;
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ] as const) {
            const sx = x * 2 + dx;
            const sy = y * 2 + dy;
            if (sx < w && sy < h) {
              sum += img.data[(sy * w + sx) * 4 + c]!;
              n++;
            }
          }
          out.data[(y * out.width + k * Math.ceil(w / 2) + x) * 4 + c] = Math.round(sum / n);
        }
  });
  return PNG.sync.write(out);
}

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
