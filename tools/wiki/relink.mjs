// Which map place a card's wiki link [label](Page_title) goes to. The panel (src/ui/placePanel.ts nameLink) only matches the page
// title, and "The " + title, against the map's names; every other way a link reaches the map is decided here and written into the
// page title, so the card links to the map (red) instead of the wiki (yellow). In order:
//   1. tools/wiki/link-fixes.json: "Card|Title" or "Title" -> map name, or null to keep the wiki link (hand-checked cases)
//   2. the title is a map name already
//   3. a wiki redirect to a map name ("Gods Eye" -> "God's Eye", "Harrentown" -> "Harrenton")
//   4. the article a map place shows (_places.json read backwards: "Inn at the crossroads" -> "The Crossroads Inn"); when several
//      places share it, the one whose name holds the title ("Yi Ti" -> "The Jungles of Yi Ti")
//   5. the label is a map name ("House Blackmont" labelled "Blackmont" -> the castle), except a building of a 3D site unless the
//      card or the title is from that site (a Riverrun "godswood" is not Winterfell's Godswood)
import { readFileSync } from 'node:fs';

const DIR = 'docs/sources/wiki';
export const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** sites: { building name: site article } for the 3D sites' buildings (src/sites/site-wiki.json "Part of"). */
export function relinker(sites) {
  const { redirects } = JSON.parse(readFileSync(`${DIR}/_index.json`, 'utf8'));
  const { places } = JSON.parse(readFileSync(`${DIR}/_places.json`, 'utf8'));
  const fixes = JSON.parse(readFileSync('tools/wiki/link-fixes.json', 'utf8'));
  const names = new Map();
  for (const [, n] of readFileSync('src/world-data.ts', 'utf8').matchAll(/\["((?:[^"\\]|\\.)+)","[a-z]+",-?\d/g)) names.set(fold(n), n);
  for (const n of Object.keys(sites)) names.set(fold(n), n);
  const onMap = (t) => { const s = t.replace(/ \([^)]*\)$/, ''); return names.get(fold(s)) ?? names.get(fold(`The ${s}`)) ?? null; };
  const byArticle = {};
  for (const [n, f] of Object.entries(places)) (byArticle[fold(decodeURIComponent(f).replace(/\.md$/, '').replace(/_/g, ' '))] ??= new Set()).add(n);
  const plain = (s) => fold(s).replace(/-/g, ' ');
  const target = (card, page, label) => {
    let t = page.split('#')[0];
    try { t = decodeURIComponent(t); } catch { /* raw */ }
    t = t.replace(/_/g, ' ');
    const fix = fixes[`${card}|${t}`] !== undefined ? fixes[`${card}|${t}`] : fixes[t];
    if (fix !== undefined) return fix;
    if (onMap(t)) return null; // the panel finds it as it is
    const r = redirects[t] ?? t;
    if (onMap(r)) return onMap(r);
    let c = [...(byArticle[fold(r)] ?? [])];
    if (c.length > 1) c = c.filter((n) => plain(n).includes(plain(r)));
    if (c.length === 1) return c[0];
    const l = onMap(label);
    if (!l) return null;
    const site = sites[l];
    if (site && !fold(t).includes(fold(site)) && card !== site && sites[card] !== site) return null;
    return l;
  };
  let changed = 0;
  const relink = (card, text) => text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, page) => {
    const n = target(card, page, label);
    if (!n) return m;
    changed++;
    return `[${label}](${n.replace(/ /g, '_')})`;
  });
  return { relink, count: () => changed };
}
