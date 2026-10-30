// Paste into the DevTools console on any awoiaf.westeros.org page (after the Cloudflare check passed).
// Walks Category:Places and every subcategory. Result: downloaded as _place-categories.json (save as docs/sources/wiki/_place-categories.json),
// and also left in window.placeCats and (if the browser allows) copied to the clipboard.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = async (p) => {
    for (let i = 0; i < 5; i++) {
      await sleep(400);
      try {
        const res = await fetch(`/api.php?format=json&formatversion=2&maxlag=5&${new URLSearchParams(p)}`);
        const text = await res.text();
        const j = JSON.parse(text);
        if (!j.error) return j;
        console.warn('API error', j.error);
      } catch (e) { console.warn('request failed', e.message); }
      await sleep(2 ** i * 2000);
    }
    throw new Error('gave up on ' + JSON.stringify(p));
  };
  console.log('start, on', location.href);
  const seen = new Set(), pages = {}, queue = ['Category:Places'];
  while (queue.length) {
    const cat = queue.shift();
    if (seen.has(cat)) continue;
    seen.add(cat);
    for (let cont = {}; cont;) {
      const r = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: 'max', cmtype: 'page|subcat', ...cont });
      const ms = r.query?.categorymembers ?? [];
      if (!ms.length && !cont.cmcontinue) console.warn('empty:', cat);
      for (const m of ms) {
        if (m.ns === 14) queue.push(m.title);
        else if (m.ns === 0) (pages[m.title] ??= []).push(cat.replace('Category:', ''));
      }
      cont = r.continue;
    }
    console.log(`${seen.size} categories, ${queue.length} queued, ${Object.keys(pages).length} pages`);
  }
  window.placeCats = { categories: [...seen].sort(), pages };
  const json = JSON.stringify(window.placeCats, null, 1);
  console.log(`done: ${seen.size} categories, ${Object.keys(pages).length} pages, ${json.length} bytes`);
  try { copy(json); console.log('copied to clipboard'); } catch {}
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([json])), download: '_place-categories.json' });
  document.body.append(a); a.click(); a.remove();
})().catch((e) => console.error('FAILED:', e));
