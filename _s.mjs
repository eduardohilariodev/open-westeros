import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1831, height: 880 } });
p.on('console', m => console.log('C', m.text().slice(0,300)));
p.on('pageerror', e => console.log('E', e.message.slice(0,300)));
await p.goto('http://localhost:5173/');
await p.waitForTimeout(40000);
await p.screenshot({ path: 'C:/Users/AVELL/AppData/Local/Temp/claude/c--Users-AVELL-dev-map/d0ce5eef-2b06-455b-ab99-866025d773c5/scratchpad/m.png' });
await b.close();
