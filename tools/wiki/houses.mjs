// The houses of the map, from the scraped wiki house articles (docs/sources/wiki, npm run wiki): seat, region, head, sigil and the
// overlord in each book period. A house is kept when its seat is a place on the map. Writes src/houses.json.
// The liege graph is the wiki's `Overlords` row (third source after the novels, CLAUDE.md); where the row names a book
// (AGOT, ACOK...) or years that is the period, a bare entry holds in every period.
// Usage: node tools/wiki/houses.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { plain, titleOf } from './md.mjs';

const DIR = 'docs/sources/wiki';
export const PERIODS = ['agot', 'acok', 'asos', 'adwd'];
// A representative year (AC) for each period, to place a "(283-298 AC)" entry.
const YEAR = { agot: 298, acok: 299, asos: 299, adwd: 300 };
const BOOK = { agot: 'agot', acok: 'acok', asos: 'asos', affc: 'adwd', adwd: 'adwd' };

// The periods an overlord entry's note ("AGOT", "ACOK, ASOS", "283-298 AC") covers; every period when it has none.
export function periodsOf(note) {
  if (!note) return PERIODS;
  if (/historical|former|before|ancient|extinction/i.test(note)) return []; // long gone, in no book period
  const books = [...note.matchAll(/\b(AGOT|ACOK|ASOS|AFFC|ADWD)\b/gi)].map((m) => BOOK[m[1].toLowerCase()]);
  if (books.length) return PERIODS.filter((p) => books.includes(p));
  const years = [...note.matchAll(/(\d+)\s*(BC|AC)?/g)].map((m) => [Number(m[1]), m[2]]);
  if (!years.length) return PERIODS;
  const era = years.find(([, e]) => e)?.[1] ?? 'AC';
  const [a, b] = years.map(([n, e]) => ((e ?? era) === 'BC' ? -n : n));
  if (years.length === 1) {
    if (/^\s*[?–-]/.test(note)) return PERIODS.filter((p) => YEAR[p] <= a); // "?–299 AC": up to
    if (/[–-]\s*(present)?\s*$/i.test(note)) return PERIODS.filter((p) => YEAR[p] >= a); // "300 AC–present": from
    return PERIODS.filter((p) => YEAR[p] === a);
  }
  return PERIODS.filter((p) => YEAR[p] >= a && YEAR[p] <= b);
}

// One house article: { label, sigil, region, head, seats: [[title, formerly]], overlords: [[houseTitle, periods]] }.
export function parseHouse(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, '');
  const lead = body.slice(body.indexOf('\n')).split(/^## /m)[0];
  const row = (k) => lead.match(new RegExp(`^\\| ${k} \\|(.+)\\|$`, 'm'))?.[1] ?? '';
  const sigil = lead.match(/^\| \[!\[[^\]]*\]\(https:\/\/awoiaf\.westeros\.org\/thumb\.php\?f=([^&)\s]+)&/m)?.[1];
  const words = plain(lead.match(/^\| \[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)<br>([^|]+?) \|$/m)?.[1] ?? '') || undefined; // the motto under the picture
  const label = plain(lead.match(/^\| (House [^|]+?) \|$/m)?.[1] ?? '') || undefined; // a title can hold a link ("House Lydden of the [Deep Den](Deep_Den.md)")
  const seats = row('Seats?').split('<br>').flatMap((seg) => {
    const former = /former|ruin|lost|exile|stripped/i.test(seg.replace(/\]\([^)]*\)/g, ']'));
    return [...seg.matchAll(/\]\(([^)\s#]+)\.md\)/g)].map((m) => [titleOf(m[1]), former]);
  });
  const overlords = row('Overlords?').split('<br>').flatMap((seg) => {
    const link = seg.match(/^\s*(?:-\s+)?\[[^\]]*\]\((House_[^)\s#]+)\.md\)/); // the entry starts with the house; a link inside a note is not a liege ("None, sovereign (disputed by House ...)")
    if (!link) return [];
    const note = plain(seg.slice(seg.indexOf(link[0]) + link[0].length)).match(/\(([^)]*)\)/)?.[1];
    return [[titleOf(decodeURIComponent(link[1])), periodsOf(note)]];
  });
  return {
    label, words, sigil: sigil && decodeURIComponent(sigil), seats, overlords,
    region: plain(row('Region')).replace(/\s*\(.*$/, '') || undefined,
    head: plain(row('Head')).replace(/^(Lord|Lady|King|Queen|Prince|Princess|Ser)\s+/, '').replace(/\s*\(.*$/, '') || undefined,
  };
}

const slug = (title) => title.replace(/^House /, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The royal houses the Conquest or the Rebellion ended (Targaryen, 1-282 AC): kept so the map before 1 AC has kings (they exist until then, state/changes.ts reads `extinct`).
const HISTORICAL = new Set(['House Gardener', 'House Durrandon', 'House Hoare', 'House Targaryen']);

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` || process.argv[1]?.endsWith('houses.mjs')) {
  const { places } = JSON.parse(readFileSync(`${DIR}/_places.json`, 'utf8'));
  const placeOfTitle = new Map(Object.entries(places).map(([name, file]) => [titleOf(decodeURIComponent(file).replace(/\.md$/, '')), name]));

  const all = {};
  for (const f of readdirSync(DIR)) {
    if (!f.startsWith('House_') || !f.endsWith('.md')) continue;
    const md = readFileSync(`${DIR}/${f}`, 'utf8');
    const title = md.match(/^# (.+)/m)?.[1];
    const h = title && parseHouse(md);
    // Extinct houses are marked "Extinct" as head, or have neither a head nor an overlord row.
    if (h?.sigil && (HISTORICAL.has(title) || (h.head !== 'Extinct' && (h.head || h.overlords.length)))) all[title] = h;
  }

  const kept = {}, unseated = [];
  for (const [title, h] of Object.entries(all)) {
    const pick = h.seats.find(([s, former]) => !former && placeOfTitle.has(s)) ?? h.seats.find(([s]) => placeOfTitle.has(s));
    if (!pick) { unseated.push(title); continue; }
    kept[title] = { id: slug(title), name: h.label ?? title, title, sigil: h.sigil, ...(h.words && { words: h.words }), seat: placeOfTitle.get(pick[0]), ...(h.region && { region: h.region }), ...(h.head && h.head !== 'Extinct' && { head: h.head }), ...(HISTORICAL.has(title) && { extinct: true }) };
  }
  const byTitle = (t) => kept[t]?.id;
  const houses = Object.entries(kept).map(([title, h]) => {
    // A period the wiki does not name stays empty, not guessed: Frey is AGOT Tully, ADWD Baelish and silent between, but Stark
    // is AGOT Baratheon, ADWD Bolton and a king in between, the same shape with opposite truth. Gaps are for canon overrides.
    const liege = {};
    for (const p of PERIODS) {
      const hit = all[title].overlords.find(([t, ps]) => ps.includes(p) && kept[t] && t !== title);
      liege[p] = hit ? byTitle(hit[0]) : null;
    }
    return { ...h, liege };
  });
  // Houses on one seat: the one that held it in AGOT (has a liege then), then a current seat, then the main branch (no
  // "of"), then by name, is the primary. The others keep their sidebar card but share its seat and draw no territory of their own.
  const seatGroups = {};
  for (const h of houses) (seatGroups[h.seat] ??= []).push(h);
  // The wiki's untagged overlord rows make late houses look present in AGOT (Baelish at Harrenhal), so a seat can be pinned here.
  const PRIMARY = { Harrenhal: 'whent' }; // A Game of Thrones, Catelyn: "Lady Whent, last of her line, who dwelt with her ghosts in the cavernous vaults of Harrenhal"
  const rank = (h) => `${PRIMARY[h.seat] === h.id ? 0 : 1}${h.liege.agot ? 0 : 1}${/ of /.test(h.title) ? 1 : 0}${h.title}`;
  for (const group of Object.values(seatGroups)) {
    if (group.length < 2) continue;
    group.sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
    for (const h of group.slice(1)) h.seatOf = group[0].id;
  }
  writeFileSync('src/houses.json', JSON.stringify(houses));

  const lieged = (p) => houses.filter((h) => h.liege[p]).length;
  const seatCount = {};
  for (const h of houses) (seatCount[h.seat] ??= []).push(h.id);
  const shared = Object.entries(seatCount).filter(([, v]) => v.length > 1);
  console.log(`${houses.length} houses with a map seat, ${unseated.length} without; with a liege: ${PERIODS.map((p) => `${p} ${lieged(p)}`).join(', ')}`);
  console.log(`seats shared by several houses: ${shared.map(([s, v]) => `${s} (${v.join(', ')})`).join('; ') || 'none'}`);
}

// Self-checks on the shapes seen in the wiki.
console.assert(JSON.stringify(periodsOf('ACOK, ASOS')) === '["acok","asos"]', 'books');
console.assert(JSON.stringify(periodsOf('ADWD')) === '["adwd"]', 'book');
console.assert(JSON.stringify(periodsOf(undefined)) === JSON.stringify(PERIODS), 'bare');
console.assert(JSON.stringify(periodsOf('2 BC – 282 AC')) === '[]', 'years before');
console.assert(JSON.stringify(periodsOf('283–298 AC')) === '["agot"]', 'years range');
console.assert(JSON.stringify(periodsOf('?–299 AC')) === '["agot","acok","asos"]', 'up to');
console.assert(JSON.stringify(periodsOf('300 AC–present')) === '["adwd"]', 'from');
console.assert(JSON.stringify(periodsOf('historical')) === '[]', 'historical');
const t = parseHouse('# House Tully\n\n| House Tully of Riverrun |\n| --- |\n| [![](https://awoiaf.westeros.org/thumb.php?f=House_Tully.svg&width=250)](x) |\n| Seat |Exiled (formerly [Riverrun](Riverrun.md)) |\n| Head |Lord [Edmure Tully](Edmure_Tully.md) (captive) |\n| Region |[Riverlands](Riverlands.md) |\n| Overlords |-   [House Baratheon of King\'s Landing](House_Baratheon_of_King\'s_Landing.md) (AGOT)<br>-   [House Stark](House_Stark.md) (ACOK, ASOS)<br>-   [House Baelish](House_Baelish.md) (ADWD) |\n\nText.');
console.assert(t.seats[0][0] === 'Riverrun' && t.seats[0][1] === true, JSON.stringify(t.seats));
console.assert(t.head === 'Edmure Tully' && t.region === 'Riverlands', JSON.stringify([t.head, t.region]));
console.assert(JSON.stringify(t.overlords.map(([n, p]) => [n, p.join('+')])) === '[["House Baratheon of King\'s Landing","agot"],["House Stark","acok+asos"],["House Baelish","adwd"]]', JSON.stringify(t.overlords));
