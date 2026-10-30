// Open the world headless, fly to places, screenshot them and report what the page says: for agents, no browser window to drive.
// Usage: npm run shot -- "Winterfell" ["The Wall" ...] [--flat] [--size 1280x720] [--out dir] [--zoom f] [--tilt rad] [--eval "js"] [--url http://localhost:5173] [--query quality=low]
//   Starts the vite dev server when --url is not given and nothing answers on 5199; stops it after. One page load serves every place.
//   Per place: png in --out (default tmp/shots/<name>.png) and one JSON line: card title, tab title, address, camera altitude/centre, console errors.
//   --zoom f multiplies the camera height by f after each fly-to (the camera stops 600 km above the ground: cameraRig.ts MIN_ALT).
//   --eval runs in the page after each fly-to (window.__globe, __renderer, __THREE exist in dev) and its result goes in the JSON.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args.splice(i, 2)[1]; };
const flag = (k) => { const i = args.indexOf('--' + k); return i >= 0 && !!args.splice(i, 1); };
const flat = flag('flat'), outDir = opt('out', 'tmp/shots'), expr = opt('eval'), zoom = +opt('zoom', 0), tilt = +opt('tilt', 0), given = opt('url');
const [width, height] = opt('size', '1280x720').split('x').map(Number);
const names = args;
if (!names.length) { console.log('usage: npm run shot -- "Place" ["Place" ...] [--flat] [--size WxH] [--out dir] [--eval js] [--url u]'); process.exit(1); }

const base = given ?? 'http://localhost:5199', extra = opt('query', '');
const up = () => fetch(base).then((r) => r.ok, () => false);
let server;
if (!(await up())) {
  if (given) throw new Error(`nothing answers at ${given}`);
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5199', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) { server.kill(); throw new Error('dev server did not start'); }
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let exit = 0;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // the first place goes in the address, which is also what a shared link does
  await page.goto(`${base}/?place=${encodeURIComponent(names[0])}${extra ? '&' + extra : ''}`);
  await page.waitForSelector('#loading', { state: 'detached', timeout: 60_000 }); // the coin finale, at least ~4 s
  if (flat) await page.click('#reliefBtn');
  for (const [k, name] of names.entries()) {
    const found = await page.evaluate((n) => {
      const i = window.__globe.places.findIndex((p) => p.name.toLowerCase() === n.toLowerCase());
      if (i >= 0) window.__wake?.(); if (i >= 0) window.__globe.flyToPlace(i);
      return i >= 0;
    }, name);
    if (!found) { console.log(JSON.stringify({ place: name, error: 'no such place (npm run lore -- search)' })); exit = 1; continue; }
    // settled: the camera has not moved for 600 ms (the flight and the zoom ease are over)
    const settle = async () => {
      let prev = '', still = 0;
      for (let i = 0; i < 120 && still < 3; i++) {
        await page.waitForTimeout(200);
        const now = await page.evaluate(() => { window.__wake?.(); const c = window.__globe.camera.position; return `${c.x.toFixed(0)},${c.y.toFixed(0)},${c.z.toFixed(0)}`; });
        still = now === prev ? still + 1 : 0; prev = now;
      }
    };
    await settle();
    // after the flight has landed: a zoom during it cancels it (cameraRig zoomTo)
    if (zoom) await page.evaluate((f) => window.__globe.nav.zoom(f), zoom);
    if (tilt) await page.evaluate((t) => window.__globe.nav.setTilt(t), tilt);
    if (zoom || tilt) await settle();
    await page.waitForTimeout(800); // textures arrive on their own
    const file = `${outDir}/${name.replace(/[^\w-]+/g, '_')}${flat ? '_flat' : ''}.png`;
    await page.screenshot({ path: file });
    const state = await page.evaluate(() => {
      const n = window.__globe.nav, c = n.pick({ x: 0, y: 0 });
      return { card: document.querySelector('#place h1')?.textContent, title: document.title, address: location.search, altitudeKm: +(n.altitude() / 1000).toFixed(1), centre: c && [+c.lat.toFixed(2), +c.lon.toFixed(2)] };
    });
    const extra = expr ? await page.evaluate((e) => { try { return eval(e); } catch (x) { return `error: ${x}`; } }, expr) : undefined;
    console.log(JSON.stringify({ place: name, file, ...state, ...(expr ? { eval: extra } : {}), errors: k === names.length - 1 ? [...new Set(errors)] : undefined }));
  }
  if (errors.some((e) => !/NotSameOrigin/.test(e))) exit = exit || 2; // NotSameOrigin: wiki pictures blocked by their host, expected
} finally {
  await browser.close();
  server?.kill();
}
process.exitCode = exit;
