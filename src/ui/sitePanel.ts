import type { Place, SiteView } from '../sites/SiteScene';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const wikiUrl = (name: string) => 'https://awoiaf.westeros.org/index.php/' + encodeURIComponent(name.replace(/ /g, '_'));

/** The side panel for whichever site is open: filters, search, tour, info card. Call show() on every site switch. */
export function createSitePanel() {
  let view: SiteView | null = null;
  let timer = 0;
  const info = $('info'), tourBtn = $<HTMLButtonElement>('tour');

  function select(p: Place | null) {
    if (!view) return;
    if (!p) {
      info.innerHTML = `<h3>${view.name}</h3><p>${view.overview}</p><a href="${wikiUrl(view.name)}" target="_blank" rel="noopener">A Wiki of Ice and Fire →</a>`;
      return;
    }
    history.replaceState(null, '', `#${view.id}/${encodeURIComponent(p.name)}`);
    document.body.classList.remove('drawer-open'); // make room for the place's card
    info.innerHTML = `<button class="close" aria-label="Close">×</button><div class="kind">${p.kind}</div><h3>${p.name}</h3>
      <p>${view.lore[p.name] ?? ''}</p><a href="${wikiUrl(p.name)}" target="_blank" rel="noopener">Read more on A Wiki of Ice and Fire →</a>`;
    info.querySelector('.close')!.addEventListener('click', () => {
      history.replaceState(null, '', `#${view!.id}`);
      select(null);
    });
  }
  function stopTour() {
    clearTimeout(timer);
    timer = 0;
    tourBtn.textContent = '▶ Tour';
  }
  const go = (p: Place) => { stopTour(); select(p); view!.flyTo(p); };

  tourBtn.onclick = () => {
    if (!view) return;
    if (timer) return stopTour();
    tourBtn.textContent = '■ Stop tour';
    const v = view;
    const step = (i: number) => {
      const p = v.places.find((q) => q.name === v.tour[i % v.tour.length]);
      if (p) { select(p); v.flyTo(p); }
      timer = window.setTimeout(() => step(i + 1), 7000);
    };
    step(0);
  };

  const checkbox = (parent: HTMLElement, text: string, checked: boolean, onChange: (on: boolean) => void) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /> ${text}`;
    l.querySelector('input')!.addEventListener('change', (e) => onChange((e.target as HTMLInputElement).checked));
    parent.append(l);
  };

  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=ground]'))
    r.addEventListener('change', () => view?.setGround?.(r.value as 'painting' | 'clean'));
  const ex = $<HTMLInputElement>('ex');
  ex.oninput = () => ($('exv').textContent = `${(+ex.value).toFixed(1)}×`);
  ex.onchange = () => view?.setExaggeration?.(+ex.value);
  const sun = $<HTMLInputElement>('sun');
  sun.oninput = () => view?.setSun(+sun.value);

  return {
    stopTour,
    go,
    show(v: SiteView) {
      stopTour();
      view = v;
      v.onPick = go;
      v.onUserMove = stopTour;
      $('siteName').textContent = v.name;
      const layers = $('layers'), labelKinds = $('labelKinds');
      layers.replaceChildren();
      labelKinds.replaceChildren();
      for (const [name, obj] of v.layers) checkbox(layers, name, obj.visible, (on) => (obj.visible = on));
      for (const [name, kinds] of v.labelGroups) {
        const objs = v.labelObjs.filter((l) => kinds.includes(l.place.kind));
        checkbox(labelKinds, name, objs.every((l) => l.obj.visible), (on) => objs.forEach((l) => (l.obj.visible = on)));
      }
      $('terrainControls').hidden = !v.setExaggeration;
      sun.value = '220';
      select(null);
    },
  };
}
