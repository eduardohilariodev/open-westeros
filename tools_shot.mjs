import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 500 } });
await p.goto('http://localhost:5199/');
await p.waitForTimeout(800);
let n = 0;
for (const f of [0.56, 0.62, 0.68]) {
  await p.evaluate((f) => { for (const a of document.getAnimations()) { const nm = a.animationName; a.pause(); a.currentTime = nm === 'coin-glint' ? 500 + 2600 * f : nm === 'coin-flip' ? 500 : nm === 'coin-toss' ? 500 + 2600 * 0.9 : a.currentTime; } }, f);
  await p.waitForTimeout(100);
  await p.screenshot({ path: `C:/Users/AVELL/AppData/Local/Temp/claude/c--Users-AVELL-dev-map/4ed951c5-3765-4805-a067-3d21600a9b56/scratchpad/g${n++}.png`, clip: { x: 250, y: 60, width: 200, height: 200 } });
}
await b.close();
