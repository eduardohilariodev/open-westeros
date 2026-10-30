// Reads a scraped wiki article (docs/sources/wiki/*.md): lead text, infobox facts, pictures; and a house article's sigil and seats.
// Shared by place-info.mjs and character-info.mjs.
import { plain, rich, titleOf } from './md.mjs';

export function parse(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, '');
  const title = body.match(/^# (.+)/m)[1];
  const lead = body.slice(body.indexOf('\n')).split(/^## /m)[0];
  const facts = [];
  for (const row of lead.matchAll(/^\| ([^|]+?) \|([^|]+?) \|$/gm)) { // two-cell infobox rows; single-cell ones are its title/caption
    if (/!\[/.test(row[2])) continue; // map or picture cell
    facts.push([plain(row[1]), rich(row[2].replace(/<br>/g, ', ').replace(/(^|, )- +/g, '$1'))]);
  }
  // Prose only: from the paragraph that names the subject in bold ("The **Trident** is..."), skipping tables and captions.
  const paras = lead.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !/^[|!\[]/.test(p));
  const start = paras.findIndex((p) => p.includes('**') && !/^\*\*[^*]+\*\*$/.test(p)); // bold name in prose, not a bold caption
  const summary = (start < 0 ? [] : paras.slice(start)).map(rich).join('\n\n');
  // The lead's first picture (the infobox's, else a location map); the wiki's "red pog" marker is not one.
  const image = [...lead.matchAll(/!\[[^\]]*\]\((https:\/\/awoiaf\.westeros\.org\/thumb\.php\?[^)\s]+)\)/g)].map((m) => m[1]).find((u) => !/f=Red_pog/.test(u));
  // The gallery: every picture in the article (file names for thumb.php), not icons or the red pog; document order, no repeats.
  // A picture's caption is the text after its <br> in an infobox cell, else the paragraph under it (none if that is a table, a heading or
  // another picture, or too long to be one). captions[i] belongs to images[i]; '' when it has none.
  const found = new Map();
  for (const m of body.matchAll(/!\[[^\]]*\]\(https:\/\/awoiaf\.westeros\.org\/thumb\.php\?f=([^&)\s]+)&width=(\d+)\)/g)) {
    if (+m[2] < 200 || /^Red_pog/.test(m[1]) || found.has(m[1])) continue;
    const tail = body.slice(m.index + m[0].length).replace(/^\]\([^)]*\)/, '');
    const raw = tail.startsWith('<br>') ? tail.slice(4).split(/ \|\s*(?:\n|$)|\n/)[0] : (tail.match(/^\s*\n\n([^\n]+)/)?.[1] ?? '');
    const caption = /^[|#!]|^\[!\[/.test(raw) ? '' : plain(raw).replace(/\s*-?\s*Click to zoom$/i, '');
    found.set(m[1], caption.length > 160 ? '' : caption);
  }
  // Artist renditions first (Ted Nasmith, Fantasy Flight Games, other credited art), plain pictures next, maps last; stable, so ties keep
  // document order. The panel's hero is then the best picture instead of the infobox's (often a map). ponytail: keyword scoring on the
  // caption/file name, a place whose art is uncredited stays as is.
  const score = (f) => { const s = `${f} ${found.get(f)}`; return /map/i.test(s) ? -5 : /Nasmith|TN-/.test(s) ? 4 : /Fantasy Flight|Jedruszek|Vela/.test(s) ? 3 : /\bby \S/.test(found.get(f)) ? 2 : 0; };
  const images = [...found.keys()].slice(0, 40).sort((a, b) => score(b) - score(a)), captions = images.map((f) => found.get(f));
  const hero = images.length && score(images[0]) > 0 ? `https://awoiaf.westeros.org/thumb.php?f=${images[0]}&width=350` : image;
  // more to read than the lead: a section after it that has some prose of its own (not just references or links)
  const more = body.slice(body.indexOf('\n')).split(/^## /m).slice(1).some((sec) => !/^(References|External links|Gallery|See also|Notes|Sources|Further reading)/i.test(sec) && sec.split('\n').slice(1).join('').replace(/\s/g, '').length > 120);
  return { title, summary, facts, image: hero, images, captions, more };
}

// A house article's infobox: its full name, coat-of-arms file (the picture in the infobox) and seats, [title, formerly?].
export function parseHouse(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, '');
  const lead = body.slice(body.indexOf('\n')).split(/^## /m)[0];
  const sigil = lead.match(/^\| \[!\[[^\]]*\]\(https:\/\/awoiaf\.westeros\.org\/thumb\.php\?f=([^&)\s]+)&/m)?.[1];
  const label = lead.match(/^\| (House [^|]+?) \|$/m)?.[1];
  const seats = [...(lead.match(/^\| Seats? \|(.+)\|$/m)?.[1] ?? '').matchAll(/\]\(([^)\s]+)\.md\)([^[<|]*)/g)]
    .map((m) => [titleOf(decodeURIComponent(m[1])), /former|ruin|lost/i.test(m[2])]); // doc links are the file name, encoded once more
  return { label, sigil: sigil && decodeURIComponent(sigil), seats };
}
