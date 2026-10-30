import type { Card } from '../globe/GlobeView';
import { PLACE_INFO } from '../place-info';
import PLACE_ALT from '../place-alt.json';
import { endCharacter } from './characterPanel';
import HOUSES from '../houses.json';
import { stateAt } from '../state/changes';
import { onPeriod, START } from '../state/time';
import { spoilerButton, spoilerSafe } from './spoiler';

/** "Held by" at the moment, as a wiki link, for a seat or a place some house has held by then (state/changes.ts); null otherwise. */
const heldBy = (name: string): string | null => {
  const now = stateAt(name).holder, seat = stateAt(name, START).holder;
  if (!now && !seat) return null;
  const h = HOUSES.find((x) => x.id === now);
  return h ? `[${h.name}](${h.title.replace(/ /g, '_')})` : 'no one';
};
let shown: Card = null; // the open card, drawn again when the moment changes
onPeriod(() => { if (shown && !place.hidden) showCard(shown); });

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
// A house chip opens that house's sidebar; main.ts finds the house by its name or sigil file.
let openHouse: (label: string, file: string) => void = () => {};
export const onHouse = (fn: typeof openHouse) => { openHouse = fn; };
// A place with a 3D model (a site, or a building in one) gets the "3D model" button; `modelFor` returns what it opens, or null.
let modelFor: (c: NonNullable<Card>) => (() => void) | null = () => null;
export const onModel = (fn: typeof modelFor) => { modelFor = fn; };
const nameLink = (page: string, label: string, ...kids: (Node | string)[]) => {
  let title = page.split('#')[0];
  try { title = decodeURIComponent(title); } catch { /* keep it raw */ }
  title = title.replace(/_/g, ' ').replace(/ \([^)]*\)$/, '');
  // the wiki drops the article the map keeps: "North" for "The North", "Reach" for "The Reach"
  const go = [title, `The ${title}`, label, `The ${label}`].reduce<(() => void) | null>((found, n) => found ?? resolve(n), null);
  if (!go) return anchor(WIKI + page, ...(kids.length ? kids : [label]));
  const a = document.createElement('a');
  a.href = '#'; a.className = 'to-map'; a.title = `Show ${label} on the map`;
  a.onclick = (e) => { e.preventDefault(); place.classList.remove('full', 'min'); go(); }; // a full-screen card drops to half so the map shows the place
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
// The focused place is in the address (?place=Name, shareable, opened again by main.ts) and in the tab title.
let baseTitle = '';
const syncAddress = (c: Card) => {
  baseTitle ||= document.title;
  document.title = c ? `${stateAt(c.name).name ?? c.name} · ${baseTitle}` : baseTitle;
  const u = new URL(location.href);
  if (c) u.searchParams.set('place', c.name); else u.searchParams.delete('place');
  history.replaceState(null, '', u);
};
let revealed = ''; // the place whose wiki text the reader chose to see
export const showCard = (c: Card) => {
  endCharacter(); // the card is a place's from here on: the character's journey leaves the map and the card's character parts go
  place.classList.remove('character');
  for (const s of ['.char-bar', '.char-steps', '.char-credit']) q(s).hidden = true;
  if (place.hidden) place.classList.remove('full', 'min'); // a place opens at rest (phones, style.css)
  place.hidden = !c;
  if (c) dispatchEvent(new Event('placeopen')); // the house card (ui/housePanel.ts) gives way
  syncAddress(c);
  shown = c;
  if (!c) return;
  const info = PLACE_INFO[`${c.name} (${c.kind.toLowerCase()})`] ?? PLACE_INFO[c.name] ?? {};
  const hero = q<HTMLImageElement>('.hero');
  hero.hidden = !info.image;
  hero.src = info.image ?? '';
  q('h1').textContent = stateAt(c.name).name ?? c.name;
  const alt = (PLACE_ALT as Record<string, string>)[c.name];
  if (alt) q('h1').append(' ', Object.assign(document.createElement('small'), { textContent: `(${alt})` })); // the Dothraki or original name
  q('.kind').textContent = c.kind;
  const wikiText = !c.text && !!(info.summary || info.facts?.length), safe = spoilerSafe(revealed === c.name), hide = wikiText && !safe; // the wiki lead and facts are written after the whole story
  if (hide) q('.summary').replaceChildren(spoilerButton(() => { revealed = c.name; showCard(c); }));
  else fill(q('.summary'), c.text ?? info.summary ?? '');
  const model = modelFor(c);
  q('.model').hidden = !model;
  q('.model').onclick = model;
  q<HTMLAnchorElement>('.wiki').href = WIKI + encodeURIComponent((info.wiki ?? c.name).replace(/ /g, '_'));
  // the lead is all the card shows; a link at the end of it when the article has more to read
  const more = q<HTMLAnchorElement>('.more');
  more.href = q<HTMLAnchorElement>('.wiki').href; more.hidden = !('more' in info && info.more) || !!c.text || hide;
  q('.credit').hidden = !info.wiki || !!c.text || hide;
  // Houses of the place: the sigil opens the wiki's file page (author and licence), the name opens the house's article.
  q('.sigils-credit').hidden = !info.houses;
  const holder = stateAt(c.name).holder; // a house that shares the seat (Bolton of Winterfell) shows only once it holds it
  q('.houses').replaceChildren(...(info.houses ?? []).filter(([, , label]) => { const h = HOUSES.find((x) => x.name === label); return !h?.seatOf || (!!holder && (h.id === holder || h.id.startsWith(holder + '-'))); }).map(([, file, label]) => {
    const chip = document.createElement('button'), img = new Image();
    chip.type = 'button'; chip.className = 'house';
    img.src = `/sigils/${file.replace(/\.[^.]+$/, '.webp')}`; img.alt = `Coat of arms of ${label}`;
    img.onerror = () => chip.remove();
    chip.append(img, label);
    chip.onclick = () => openHouse(label, file);
    return chip;
  }));
  const held = heldBy(c.name);
  const facts: [string, string][] = [...(held ? [['Held by', held] as [string, string]] : []), ...(c.region ? [['Region', `[${c.region}](${c.region.replace(/ /g, '_')})`] as [string, string]] : []), ...(hide ? [] : info.facts ?? [])];
  if (c.lat !== undefined && c.lon !== undefined) facts.push(['Coordinates', `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°`]);
  q('.facts').replaceChildren(...facts.map(([k, v]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="k"></span><span></span>';
    li.firstChild!.textContent = k; fill(li.lastChild as HTMLElement, v);
    return li;
  }));
  files = info.images ?? [];
  captions = info.captions ?? [];
  // Phones (style.css): the pictures are a row of tiles right after the title, as in Google Maps; the wiki lead picture when it has no gallery
  const row = q('.photo-row'), pics: [string, number][] = files.length ? files.map((f, i) => [thumb(f, 400), i]) : info.image ? [[info.image, -1]] : [];
  row.replaceChildren(...pics.map(([src, i]) => {
    const b = document.createElement('button'), img = new Image();
    img.src = src; img.alt = ''; img.loading = 'lazy'; img.onerror = () => b.remove();
    b.type = 'button'; b.append(img); if (i >= 0) b.onclick = () => openGallery(i);
    return b;
  }));
  row.hidden = !pics.length;
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
const viewer = $('viewer'), big = viewer.querySelector<HTMLImageElement>('.big')!, strip = viewer.querySelector<HTMLElement>('.strip')!, caption = viewer.querySelector<HTMLElement>('.caption')!, wikiLink = viewer.querySelector<HTMLAnchorElement>('.wiki-link')!;
const tryWidth = () => { big.src = thumb(files[at], widths.shift()!); };
big.onerror = () => { if (widths.length) tryWidth(); else big.classList.add('ready'); };
big.onload = () => big.classList.add('ready'); // the skeleton gives way (style.css)
const showImage = (i: number) => {
  at = (i + files.length) % files.length;
  big.classList.remove('ready'); // the skeleton shows until the picture has loaded
  widths = [1600, 1200, 800, 400, 200];
  tryWidth();
  caption.textContent = captions[at] ?? ''; caption.hidden = !caption.textContent;
  wikiLink.href = `${WIKI}File:${encodeURIComponent(files[at])}`; // the picture's file page: author and licence
  [...strip.children].forEach((b, j) => b.classList.toggle('on', j === at));
  strip.children[at].scrollIntoView({ inline: 'center', block: 'nearest' });
};
const openGallery = (i: number) => {
  if (!files.length) return;
  const many = files.length > 1;
  strip.hidden = !many;
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
viewer.onclick = (e) => { if (e.target === viewer || (e.target as Element).classList.contains('stage')) closeGallery(); };
// no arrows: swipe the picture, press ←/→, or pick from the strip
let swipeX = 0, swipeY = 0;
viewer.addEventListener('touchstart', (e) => { swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; }, { passive: true });
viewer.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - swipeX, dy = e.changedTouches[0].clientY - swipeY;
  if (files.length > 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(e.target as Element).closest('.strip')) showImage(at + (dx < 0 ? 1 : -1));
}, { passive: true });
viewer.querySelector<HTMLElement>('.close')!.onclick = closeGallery;
addEventListener('keydown', (e) => {
  if (viewer.hidden) return;
  if (e.key === 'Escape') closeGallery();
  else if (e.key === 'ArrowLeft') showImage(at - 1);
  else if (e.key === 'ArrowRight') showImage(at + 1);
});

// Phones: the card has three heights, minimised (the title only), half and full. The text scrolls at half and full without changing it.
// Swiping up on the handle, title, Wiki button or pictures raises the card a step; swiping down on them lowers it a step. Swiping down
// on the text lowers it too, if the text was at its top when the swipe began. A tap on the title toggles half and full.
const phone = matchMedia('(max-width: 700px)'), head = q('.head'), body = q('.body');
const height = () => (place.classList.contains('full') ? 2 : place.classList.contains('min') ? 0 : 1);
const setHeight = (n: number) => {
  if (n === 0) place.style.setProperty('--min-h', `${head.offsetHeight + 14}px`); // handle and title
  place.classList.toggle('min', n === 0); place.classList.toggle('full', n === 2);
};
let touchY = 0, onHandle = false, atTop = true, stepped = false;
place.addEventListener('touchstart', (e) => {
  touchY = e.touches[0].clientY;
  const t = e.target as Element;
  onHandle = t === place || !!t.closest('.head, .actions, .photo-row');
  atTop = body.scrollTop <= 0;
  stepped = false; // one step a swipe: a long swipe from minimised stops at half
}, { passive: true });
place.addEventListener('touchmove', (e) => {
  if (!phone.matches || stepped) return;
  const y = e.touches[0].clientY, dy = y - touchY, h = height();
  if (dy < -14 && h < 2 && (onHandle || h === 0)) { setHeight(h + 1); stepped = true; }
  else if (dy > 14 && h > 0 && (onHandle || atTop)) { setHeight(h - 1); stepped = true; }
}, { passive: true });
// a scroll up (mouse wheel or trackpad) on the minimised card raises it to half
place.addEventListener('wheel', (e) => { if (phone.matches && height() === 0 && e.deltaY > 0) setHeight(1); }, { passive: true });
head.addEventListener('click', (e) => {
  if (!phone.matches || (e.target as Element).closest('.close')) return;
  setHeight(height() === 1 ? 2 : 1);
});

export const isOpen = () => !place.hidden;
export const onClose = (fn: () => void) => { q('.close').onclick = fn; };
