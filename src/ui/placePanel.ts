import type { Card } from '../globe/GlobeView';
import { PLACE_INFO } from '../place-info';

const $ = (id: string) => document.getElementById(id)!;

// One place panel for whatever was picked: a place on the globe, a landmark inside a 3D place. Wiki facts from src/place-info.ts.
const place = $('place'), q = <T extends Element>(s: string) => place.querySelector<T & HTMLElement>(s)!;
const WIKI = 'https://awoiaf.westeros.org/index.php/';
const anchor = (href: string, ...kids: (Node | string)[]) => {
  const a = document.createElement('a');
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.append(...kids);
  return a;
};
// A name with a place on the map goes there (the card has its own wiki button); `resolve` returns the way there, or null.
let resolve: (name: string) => (() => void) | null = () => null;
export const onNavigate = (fn: typeof resolve) => { resolve = fn; };
const nameLink = (page: string, label: string, ...kids: (Node | string)[]) => {
  let title = page.split('#')[0];
  try { title = decodeURIComponent(title); } catch { /* keep it raw */ }
  title = title.replace(/_/g, ' ').replace(/ \([^)]*\)$/, '');
  // the wiki drops the article the map keeps: "North" for "The North", "Reach" for "The Reach"
  const go = [title, `The ${title}`, label, `The ${label}`].reduce<(() => void) | null>((found, n) => found ?? resolve(n), null);
  if (!go) return anchor(WIKI + page, ...(kids.length ? kids : [label]));
  const a = document.createElement('a');
  a.href = '#'; a.className = 'to-map'; a.title = `Show ${label} on the map`;
  a.onclick = (e) => { e.preventDefault(); go(); };
  a.append(...(kids.length ? kids : [label]));
  return a;
};
// Text with [label](Page_title#section) links (see tools/wiki/place-info.mjs) becomes text and links to that page of the wiki.
const fill = (el: HTMLElement, text: string) => {
  const nodes: (Node | string)[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    nodes.push(text.slice(last, m.index), nameLink(m[2], m[1]));
    last = m.index + m[0].length;
  }
  el.replaceChildren(...nodes, text.slice(last));
};
export const showCard = (c: Card) => {
  place.hidden = !c;
  if (!c) return;
  const info = PLACE_INFO[`${c.name} (${c.kind.toLowerCase()})`] ?? PLACE_INFO[c.name] ?? {};
  const hero = q<HTMLImageElement>('.hero');
  hero.hidden = !info.image;
  hero.src = info.image ?? '';
  q('h1').textContent = c.name;
  q('.kind').textContent = c.kind;
  fill(q('.summary'), c.text ?? info.summary ?? '');
  q<HTMLAnchorElement>('.act').href = WIKI + encodeURIComponent((info.wiki ?? c.name).replace(/ /g, '_'));
  q('.credit').hidden = !info.wiki || !!c.text;
  // Houses of the place: the sigil opens the wiki's file page (author and licence), the name opens the house's article.
  q('.sigils-credit').hidden = !info.houses;
  q('.houses').replaceChildren(...(info.houses ?? []).map(([page, file, label]) => {
    const chip = document.createElement('span'), img = new Image();
    chip.className = 'house';
    img.src = `/sigils/${file.replace(/\.[^.]+$/, '.webp')}`; img.alt = `Coat of arms of ${label}`;
    img.onerror = () => chip.remove();
    chip.append(anchor(`${WIKI}File:${file}`, img), nameLink(encodeURIComponent(page.replace(/ /g, '_')), label));
    return chip;
  }));
  const facts: [string, string][] = [...(c.region ? [['Region', `[${c.region}](${c.region.replace(/ /g, '_')})`] as [string, string]] : []), ...(info.facts ?? [])];
  if (c.lat !== undefined && c.lon !== undefined) facts.push(['Coordinates', `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°`]);
  q('.facts').replaceChildren(...facts.map(([k, v]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="k"></span><span></span>';
    li.firstChild!.textContent = k; fill(li.lastChild as HTMLElement, v);
    return li;
  }));
  files = info.images ?? [];
  captions = info.captions ?? [];
  q('.photos').hidden = !files.length;
  if (files.length) { q<HTMLImageElement>('.tile img').src = thumb(files[0], 400); q('.tile span').textContent = `Images (${files.length})`; }
  q('.body').scrollTop = 0;
};
q<HTMLImageElement>('.hero').onerror = () => { q('.hero').hidden = true; }; // hot-linked: hide it if it fails

// Gallery: the place's pictures from its wiki article (file names in place-info), opened by the panel's picture or its
// Images tile. thumb.php resizes by width but refuses to upscale (400), so the big picture tries the widest first and
// steps down. Arrows or ←/→ browse, the strip jumps, click outside the picture or Esc closes.
let files: string[] = [], captions: string[] = [], at = 0, widths: number[] = [];
const thumb = (f: string, w: number) => `https://awoiaf.westeros.org/thumb.php?f=${f}&width=${w}`;
const viewer = $('viewer'), big = viewer.querySelector<HTMLImageElement>('.big')!, strip = viewer.querySelector<HTMLElement>('.strip')!, caption = viewer.querySelector<HTMLElement>('.caption')!;
const tryWidth = () => { big.src = thumb(files[at], widths.shift()!); };
big.onerror = () => { if (widths.length) tryWidth(); };
const showImage = (i: number) => {
  at = (i + files.length) % files.length;
  widths = [1600, 1200, 800, 400, 200];
  tryWidth();
  caption.textContent = captions[at] ?? ''; caption.hidden = !caption.textContent;
  [...strip.children].forEach((b, j) => b.classList.toggle('on', j === at));
  strip.children[at].scrollIntoView({ inline: 'center', block: 'nearest' });
};
const openGallery = (i: number) => {
  if (!files.length) return;
  const many = files.length > 1;
  strip.hidden = !many;
  viewer.querySelectorAll<HTMLElement>('.nav').forEach((b) => (b.hidden = !many));
  strip.replaceChildren(...files.map((f, j) => {
    const b = document.createElement('button'), img = document.createElement('img');
    img.src = thumb(f, 200); img.loading = 'lazy'; img.alt = '';
    b.append(img); b.onclick = () => showImage(j);
    return b;
  }));
  viewer.hidden = false;
  showImage(i);
};
const closeGallery = () => { viewer.hidden = true; big.removeAttribute('src'); };
q<HTMLImageElement>('.hero').onclick = (e) => openGallery(Math.max(0, files.findIndex((f) => (e.currentTarget as HTMLImageElement).src.includes(`f=${f}&`))));
q('.tile').onclick = () => openGallery(0);
viewer.onclick = (e) => { if (e.target === viewer) closeGallery(); };
viewer.querySelector<HTMLElement>('.close')!.onclick = closeGallery;
viewer.querySelector<HTMLElement>('.prev')!.onclick = () => showImage(at - 1);
viewer.querySelector<HTMLElement>('.next')!.onclick = () => showImage(at + 1);
addEventListener('keydown', (e) => {
  if (viewer.hidden) return;
  if (e.key === 'Escape') closeGallery();
  else if (e.key === 'ArrowLeft') showImage(at - 1);
  else if (e.key === 'ArrowRight') showImage(at + 1);
});

export const isOpen = () => !place.hidden;
export const onClose = (fn: () => void) => { q('.close').onclick = fn; };
