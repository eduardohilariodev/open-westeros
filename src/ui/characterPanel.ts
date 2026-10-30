import { CHAPTERS, CHARACTER_INFO, known } from '../character-info';
import type { Character, CharStep } from '../globe/characterPath';

// A character's journey in the place card (index.html #place): the player bar under the title, the wiki lead, and the steps.
// The card is the place panel's, in character mode (style.css `#place .char-*`); placePanel.showCard puts it back to a place.
type Layer = ReturnType<typeof import('../globe/characterPath').createCharacterLayer>;
const place = document.getElementById('place')!, q = <T extends Element>(s: string) => place.querySelector<T & HTMLElement>(s)!;
const WIKI = 'https://awoiaf.westeros.org/index.php/';

/** "AGOT 12 · Eddard II", or "AGOT 12–19" for a run of chapters. */
const chapterLabel = ([a, b]: [number, number]) => {
  const t = (i: number) => /^(\w+)-(\w+): (.*)$/.exec(CHAPTERS[i]?.t ?? '');
  const x = t(a), y = t(b);
  if (!x) return '';
  if (a === b || !y || x[1] !== y[1]) return `${x[1]} ${x[2]} · ${x[3]}`;
  return `${x[1]} ${x[2]}–${y[2]}`;
};
const stepText = (s: CharStep) => {
  switch (s.kind) {
    case 'travel': return `${s.from} → ${s.to}`;
    case 'death': return `Dies ${s.at ? (/^near /.test(s.at) ? s.at : `at ${s.at}`) : ''}`.trim();
    case 'lost': return `Whereabouts unknown, ${s.at ?? ''}`.trim();
    default: return /^near /.test(s.at ?? '') ? `Stays ${s.at}` : `At ${s.at}`;
  }
};

let current: { c: Character; layer: Layer } | null = null;
let off: (() => void) | null = null;

const syncAddress = (c: Character | null) => {
  const u = new URL(location.href);
  u.searchParams.delete('place');
  if (c) u.searchParams.set('character', c.id); else u.searchParams.delete('character');
  history.replaceState(null, '', u);
  document.title = c ? `${c.name} · ${document.title.split(' · ').pop()}` : document.title.split(' · ').pop()!;
};

const refresh = () => {
  if (!current) return;
  const { c, layer } = current, i = layer.step;
  q('.char-bar .play').classList.toggle('playing', layer.playing);
  const play = q('.char-bar .play');
  play.setAttribute('aria-label', layer.playing ? 'Pause' : 'Play'); play.title = play.getAttribute('aria-label')!;
  q('.char-bar .now').textContent = i < 0 ? `Whole journey · ${c.steps.length} steps` : `${i + 1}/${c.steps.length} · ${chapterLabel(c.steps[i].chapters)}`;
  [...q('.char-steps').children].forEach((li, k) => li.classList.toggle('on', k === i));
  if (i >= 0) q('.char-steps').children[i]?.scrollIntoView({ block: 'nearest' });
};

/** Opens the card on `c` and shows its journey on the globe. */
export function showCharacter(whole: Character, layer: Layer) {
  off?.();
  const c = known(whole);
  layer.open(c);
  current = { c, layer };
  const info = CHARACTER_INFO[c.id] ?? {};
  place.hidden = false;
  place.classList.add('character');
  place.classList.remove('full', 'min');
  syncAddress(c);
  const hero = q<HTMLImageElement>('.hero');
  hero.hidden = !info.image; hero.src = info.image ?? '';
  q('h1').textContent = c.name;
  q('.kind').textContent = `Character · House ${c.house[2]}`;
  q('.model').hidden = true;
  q<HTMLAnchorElement>('.wiki').href = WIKI + encodeURIComponent(c.wiki);
  const more = q<HTMLAnchorElement>('.more');
  more.href = q<HTMLAnchorElement>('.wiki').href; more.hidden = !info.more;
  q('.credit').hidden = !info.summary;
  q('.sigils-credit').hidden = false;
  const chip = document.createElement('span'), img = new Image();
  chip.className = 'house';
  img.src = `${import.meta.env.BASE_URL}sigils/${c.house[1]}.webp`; img.alt = `Coat of arms of ${c.house[2]}`;
  img.onerror = () => chip.remove();
  const a = document.createElement('a');
  a.href = WIKI + c.house[0]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = c.house[2];
  chip.append(img, a);
  q('.houses').replaceChildren(chip);
  q('.summary').textContent = info.summary ?? '';
  q('.facts').replaceChildren(...(info.facts ?? []).map(([k, v]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="k"></span><span></span>';
    li.firstElementChild!.textContent = k; li.lastElementChild!.textContent = v;
    return li;
  }));
  q('.photo-row').hidden = true; q('.photos').hidden = true;
  q('.char-bar').hidden = false;
  q('.char-credit').hidden = false;
  const steps = q('.char-steps');
  steps.hidden = false;
  steps.style.setProperty('--c', c.color === '#808080' ? '#e9c46a' : c.color);
  steps.replaceChildren(...c.steps.map((s, k) => {
    const li = document.createElement('li');
    li.className = s.kind;
    li.innerHTML = '<span class="dot"></span><span class="what"></span><span class="ch"></span>';
    (li.querySelector('.what') as HTMLElement).textContent = stepText(s);
    (li.querySelector('.ch') as HTMLElement).textContent = chapterLabel(s.chapters);
    li.onclick = () => layer.goTo(k);
    return li;
  }));
  q('.body').scrollTop = 0;
  off = layer.onChange(refresh);
  refresh();
}

q('.char-bar .play').onclick = () => { if (current) (current.layer.playing ? current.layer.pause() : current.layer.play()); };
q('.char-bar .prev').onclick = () => current?.layer.prev();
q('.char-bar .next').onclick = () => current?.layer.next();

/** The card went back to a place or closed: let go of the character. */
export function endCharacter() {
  if (!current) return;
  off?.(); off = null;
  current.layer.close();
  current = null;
  syncAddress(null);
}
export const characterOpen = () => !!current;
