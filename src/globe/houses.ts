import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createDeclutter, offset, RINGS, setShown } from '../declutter';
import { toVector } from '../geo';
import houseData from '../houses.json';
import territoryData from '../house-territories.json';
import { buildGraph, tierOf, type Graph, type House } from '../houseGraph';
import { onPeriod } from '../state/time';
import { liegeAt } from '../state/changes';
import { inRing, lineGeometry, lineMesh } from './gpuVector';
import { lifted } from './lift';
import { tintOf } from '../sigilTint';
import type { Ring } from './viewLayer';

// The houses overlay: every house's land with its borders, the seats' coats of arms, and the lighting of a lord's realm. It sits
// over whatever terrain look is on (relief or flat). Territories are a weighted Voronoi of the seats (tools/world/house-territories.mjs);
// who holds of whom is the liege graph at the moment (houseGraph.ts, state/changes.ts), so a change of moment re-lights the realms.
const HOUSES = houseData as unknown as House[];
const T = territoryData as unknown as { cell: number; houses: Record<string, Ring[]>; seats: Record<string, [number, number]>; borders: [string, string, Ring][] };

const PALETTE = ['#d9b36a', '#9fb87a', '#c8806c', '#7fa3bd', '#b992b9', '#d6c878', '#7fb59d', '#c99a6d'];
// Neighbours get different tints: greedy colouring, the busiest houses first.
const colours = () => {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of T.borders) { for (const [p, q] of [[a, b], [b, a]]) { if (!adj.has(p)) adj.set(p, new Set()); adj.get(p)!.add(q); } }
  const col = new Map<string, number>();
  for (const id of Object.keys(T.houses).sort((x, y) => (adj.get(y)?.size ?? 0) - (adj.get(x)?.size ?? 0))) {
    const used = new Set([...(adj.get(id) ?? [])].map((n) => col.get(n)));
    let c = 0; while (used.has(c)) c++;
    col.set(id, c % PALETTE.length);
  }
  return col;
};

// Sigils come in by size class: great houses from afar, leaves only close up (camera altitude, metres); their on-screen box, px.
const SIGIL_BELOW = [16_000_000, 4_500_000, 2_200_000], SIGIL_PX = [38, 28, 22];
// Land is flat, solid colour: every territory in its great house's arms colour on a canvas (PPD px per degree), then draped on the globe;
// BLUR is the blur radius in px (0: none), the borders are lines over it.
const PPD = 32, BLUR = [0], SWORN_ALPHA = 0.11, HEAD_ALPHA = 0.17, LIT_ALPHA = [0.4, 0.26, 0.2], HOVER_ALPHA = 0.22;
const THIN_BELOW = [6_500_000, 9_000_000]; // thin borders fade out between these; the realm borders stay
const THIN_OPACITY = 0.6, REALM_OPACITY = 0.9, RING_OPACITY = 0.85; // faint: the colour carries the land, the lines only hint at the edge
/** The same hue, more saturated and mid-light, for the lit realm (a pale or muddy arms colour would drown in the map). */
const vivid = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
  if (d < 0.01) return [r, g, b];
  const h = mx === r / 255 ? ((g - b) / 255 / d + 6) % 6 : mx === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
  const s = 0.95, L = Math.min(0.55, Math.max(0.4, l)), c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = L - c / 2;
  const [R, G, B] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
  return [R, G, B].map((v) => Math.round((v + m) * 255)) as [number, number, number];
};
/** Where a house's sigil and name go: the middle of its biggest piece of land, or its seat when that middle falls outside it. [lon, lat] */
const centreOf = (id: string, seat: [number, number]): [number, number] => {
  let best: Ring | null = null, area = 0, cx = 0, cy = 0;
  for (const rg of T.houses[id]) {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
      const k = rg[j][0] * rg[i][1] - rg[i][0] * rg[j][1];
      a += k; x += (rg[j][0] + rg[i][0]) * k; y += (rg[j][1] + rg[i][1]) * k;
    }
    if (Math.abs(a) > Math.abs(area)) { area = a; best = rg; cx = x / (3 * a); cy = y / (3 * a); }
  }
  return best && inRing(cx, cy, best) ? [cx, cy] : seat;
};
/** A border colour: a grey realm's line is darkened, or it would vanish into its own fill. */
const edge = (c: number[]) => (Math.max(...c) - Math.min(...c) < 8 ? c.map((v) => Math.round(v * 0.4)) : c);
const hexRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** The sigil picture of a house: the wiki's file is an svg, public/sigils holds the webp. */
const sigilUrl = (h: House) => `${import.meta.env.BASE_URL}sigils/${h.sigil.replace(/\.[^.]+$/, '')}.webp`;

export interface HouseLayerOptions {
  R: number;
  pick: (ndc: THREE.Vector2) => { lat: number; lon: number } | null;
  dom: HTMLElement;
  blocked: () => boolean; // another tool owns the click (measuring)
  onPick: (id: string) => void; // a click on a house's land or sigil: light it and fly there
  onFocus: (id: string | null) => void;
}

export function createHouseLayer(o: HouseLayerOptions) {
  const r = o.R - 6, group = new THREE.Group();
  group.visible = false;
  let graph: Graph = buildGraph(HOUSES, (h) => liegeAt(h.id));
  let focusId: string | null = null, hoverId: string | null = null, built = false, version = 0;
  const tints = new Map<string, [number, number, number]>(); // each house's colour, from its sigil once that loads
  const territory = (id: string) => (T.houses[id] ? id : graph.by.get(id)?.seatOf ?? id); // a house on a shared seat is lit on the seat's holder
  const col = colours();
  const flat = (m: THREE.Object3D) => { Object.assign((m as THREE.Mesh).material, { depthTest: false, transparent: true }); return m; }; // over the relief, like regions.ts

  let hoverCtx: CanvasRenderingContext2D, hoverTex: THREE.CanvasTexture, hoverMesh: THREE.Mesh, ring: Border, paintCtx: CanvasRenderingContext2D, paintTex: THREE.CanvasTexture, paintBox: [number, number, number, number], soft: CanvasRenderingContext2D;
  const setLines = (l: ReturnType<typeof lineMesh>, pts: Ring[]) => {
    l.visible = pts.length > 0;
    if (!pts.length) return;
    l.geometry.dispose();
    l.geometry = lineGeometry(pts, r, false);
  };
  type Border = ReturnType<typeof borderLine>;
  const borderLine = (color: string, width: number, order: number, opacity: number) => {
    const meshes = [flat(lineMesh(lineGeometry([[[0, 0], [0, 1]]], r, false), color, width, order, opacity)) as ReturnType<typeof lineMesh>];
    let has = false, shown = 1;
    const sync = () => meshes.forEach((m) => { m.visible = has && shown > 0.01; (m.material as unknown as { opacity: number }).opacity = opacity * shown; });
    sync(); meshes.forEach((m) => { m.visible = false; });
    return {
      meshes,
      set(pts: Ring[]) { has = pts.length > 0; if (has) meshes.forEach((m) => setLines(m, pts)); sync(); },
      fade(f: number) { shown = f; sync(); },
      color(c: string) { meshes.forEach((m) => (m.material as unknown as { color: THREE.Color }).color.set(c)); },
    };
  };
  // Borders are drawn in the colour of the realm they belong to, each one once: a shared border (T.borders) in its realm's colour,
  // or the blend of both when it divides two realms, and the shore (the stretches of a house's outline that no shared border runs
  // along) in the house's realm colour. One pooled line per colour, rebuilt only when the grouping changes.
  let coast: Map<string, Ring[]> | null = null;
  const coastOf = () => {
    if (coast) return coast;
    const byHouse = new Map<string, Ring[]>();
    for (const [a, b, ring] of T.borders) for (const id of [a, b]) byHouse.set(id, [...(byHouse.get(id) ?? []), ring]);
    const tol2 = T.cell * T.cell, near = (m: number[], a: number[], b: number[]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, f = l ? Math.max(0, Math.min(1, ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / l)) : 0;
      return (a[0] + f * dx - m[0]) ** 2 + (a[1] + f * dy - m[1]) ** 2 < tol2;
    };
    coast = new Map();
    for (const [id, rings] of Object.entries(T.houses)) {
      const shared = byHouse.get(id) ?? [], out: Ring[] = [];
      for (const rg of rings) for (let i = 0; i < rg.length; i++) {
        const a = rg[i], b = rg[(i + 1) % rg.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (!shared.some((br) => br.some((q, j) => j > 0 && near(m, br[j - 1], q)))) out.push([a, b]);
      }
      coast.set(id, out);
    }
    return coast;
  };
  const thinLines = new Map<string, Border>(), realmLines = new Map<string, Border>();
  let thinFade = 1, borderSig = '';
  const drawBorders = () => {
    const realmOf = (id: string) => (graph.by.has(id) ? graph.realm(id) : id);
    const colourOf = (id: string) => vivid(rgbOf(realmOf(id)));
    const css = (c: number[]) => `rgb(${edge(c).join(',')})`;
    const thin = new Map<string, Ring[]>(), between = new Map<string, Ring[]>();
    const push = (m: Map<string, Ring[]>, k: string, rings: Ring[]) => m.set(k, [...(m.get(k) ?? []), ...rings]);
    for (const [id, rings] of coastOf()) push(between, css(colourOf(id)), rings); // the shore is drawn like a border between realms: same width and strength
    for (const [a, b, ring] of T.borders) {
      if (realmOf(a) === realmOf(b)) { push(thin, css(colourOf(a)), [ring]); continue; }
      const x = colourOf(a), y = colourOf(b);
      push(between, css(x.map((v, i) => (v + y[i]) >> 1)), [ring]);
    }
    const sig = [...thin, ...between].map(([k, v]) => `${k}:${v.length}:${v.reduce((n, rg) => n + rg.length, 0)}`).join('|');
    if (sig === borderSig) return;
    borderSig = sig;
    const apply = (pool: Map<string, Border>, groups: Map<string, Ring[]>, width: number, order: number, opacity: number, fade: number) => {
      for (const [k, l] of pool) if (!groups.has(k)) l.set([]);
      for (const [k, rings] of groups) {
        let l = pool.get(k);
        if (!l) { l = borderLine(k, width, order, opacity); l.fade(fade); pool.set(k, l); group.add(...l.meshes); }
        l.set(rings);
      }
    };
    apply(thinLines, thin, 1.5, 191, THIN_OPACITY, thinFade);
    apply(realmLines, between, 2.5, 192, REALM_OPACITY, 1);
  };
  // the focused realm's outline: borders with exactly one side inside it
  const outline = (set: Map<string, number>) => T.borders.filter(([a, b]) => set.has(a) !== set.has(b)).map((b) => b[2]);

  const sigils: { id: string; tier: number; up: THREE.Vector3; pos: THREE.Vector3; obj: CSS2DObject; chars: number; dx: number; dy: number }[] = [];
  const bounds = new Map<string, [number, number, number, number]>(); // lon0, lon1, lat0, lat1

  const build = () => {
    built = true;
    for (const [id, rings] of Object.entries(T.houses)) {
      const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
      bounds.set(id, [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]);
    }
    const [lon0, lon1, lat0, lat1] = [...bounds.values()].reduce((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])]).map((v, i) => v + (i % 2 ? 1.5 : -1.5));
    paintBox = [lon0, lon1, lat0, lat1];
    const w = Math.ceil((lon1 - lon0) * PPD), h = Math.ceil((lat1 - lat0) * PPD);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h }), out = Object.assign(document.createElement('canvas'), { width: w, height: h });
    paintCtx = canvas.getContext('2d')!; soft = out.getContext('2d')!;
    paintTex = new THREE.CanvasTexture(out); paintTex.colorSpace = THREE.SRGBColorSpace;
    // a patch of the globe over the houses' extent, one vertex per half degree, with the canvas as its texture
    const nx = Math.ceil((lon1 - lon0) * 2), ny = Math.ceil((lat1 - lat0) * 2), pos: number[] = [], uv: number[] = [], idx: number[] = [], v3 = new THREE.Vector3();
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx, t = j / ny;
      toVector(lat0 + t * (lat1 - lat0), lon0 + u * (lon1 - lon0), r, v3); pos.push(v3.x, v3.y, v3.z); uv.push(u, t);
      if (i < nx && j < ny) { const k = j * (nx + 1) + i; idx.push(k, k + 1, k + nx + 1, k + 1, k + nx + 2, k + nx + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const land = new THREE.Mesh(geo, lifted(new THREE.MeshBasicMaterial({ map: paintTex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
    land.renderOrder = 190; land.frustumCulled = false;
    ring = borderLine('#f6d98a', 4, 193, RING_OPACITY);
    // the hovered house is its own small layer, so a hover redraws one territory, not all of them
    const hcan = Object.assign(document.createElement('canvas'), { width: w, height: h });
    hoverCtx = hcan.getContext('2d')!;
    hoverTex = new THREE.CanvasTexture(hcan); hoverTex.colorSpace = THREE.SRGBColorSpace;
    hoverMesh = new THREE.Mesh(geo, lifted(new THREE.MeshBasicMaterial({ map: hoverTex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
    hoverMesh.renderOrder = 190.5; hoverMesh.frustumCulled = false; hoverMesh.visible = false;
    group.add(land, hoverMesh, ...ring.meshes);
    for (const id of Object.keys(T.houses)) { // each house's colour is its arms' main colour, read once the picture is in
      const h = HOUSES.find((x) => x.id === id);
      if (!h) continue;
      const img = new Image();
      img.onload = () => { const t = tintOf(img); if (t) { tints.set(id, t); queuePaint(); } };
      img.src = sigilUrl(h);
    }
    for (const h of HOUSES) {
      const seat = T.seats[h.seatOf ?? h.id];
      if (!seat || h.seatOf || !T.houses[h.id]) continue; // one sigil per seat, the primary house's
      const el = document.createElement('div'), img = new Image();
      el.className = 'house-sigil off';
      img.src = sigilUrl(h); img.alt = ''; img.draggable = false;
      img.onerror = () => { el.hidden = true; };
      const name = document.createElement('span');
      name.textContent = h.title; // "House Tully"
      el.title = h.name;
      el.append(img, name);
      el.onclick = (e) => { e.stopPropagation(); o.onPick(h.id); };
      el.onpointerenter = () => setHover(territory(h.id)); // the sigil sits over the land and takes the pointer, so it hovers the land for it
      el.onpointerleave = () => setHover(null);
      const [lon, lat] = centreOf(h.id, seat);
      const obj = new CSS2DObject(el), up = toVector(lat, lon, 1);
      obj.position.copy(up).multiplyScalar(o.R + 500);
      obj.visible = false;
      group.add(obj);
      sigils.push({ id: h.id, tier: tierOf(graph, h.id), up, pos: obj.position, obj, chars: h.title.length, dx: 0, dy: 0 });
    }
    refreshGraph();
  };

  let queued = false;
  const queuePaint = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; paint(); }); } };
  const rgbOf = (id: string) => tints.get(id) ?? hexRgb(PALETTE[col.get(id) ?? 0]);
  const drawLand = (colourOf: (id: string) => [[number, number, number], number]) => {
    const [lon0, , , lat1] = paintBox, { width: w, height: h } = paintCtx.canvas;
    paintCtx.clearRect(0, 0, w, h);
    for (const [id, rings] of Object.entries(T.houses)) {
      const [[cr, cg, cb], a] = colourOf(id);
      paintCtx.beginPath();
      for (const rg of rings) rg.forEach(([x, y], i) => (i ? paintCtx.lineTo : paintCtx.moveTo).call(paintCtx, (x - lon0) * PPD, (lat1 - y) * PPD));
      paintCtx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
      paintCtx.fill('evenodd');
    }
    soft.clearRect(0, 0, w, h);
    BLUR.forEach((b, i) => { soft.filter = `blur(${b}px)`; soft.globalAlpha = i ? 0.7 : 1; soft.drawImage(paintCtx.canvas, 0, 0); });
    soft.filter = 'none'; soft.globalAlpha = 1;
    paintTex.needsUpdate = true;
  };

  const paint = () => {
    const set = focusId ? graph.subtree(focusId) : null;
    const depth = new Map<string, number>();
    set?.forEach((d, id) => { const t = territory(id); depth.set(t, Math.min(d, depth.get(t) ?? Infinity)); });
    const lord = focusId ? graph.liegeOf(focusId)?.id : null;
    const head = (id: string) => (graph.by.has(id) ? graph.realm(id) : id);
    drawLand((id) => {
      const d = depth.get(id);
      if (!set) return [vivid(rgbOf(head(id))), head(id) === id ? HEAD_ALPHA : SWORN_ALPHA]; // at rest: each house in its great house's colour, sworn houses fainter
      if (d !== undefined) return [vivid(rgbOf(focusId!)), LIT_ALPHA[Math.min(d, 2)]];
      return [vivid(rgbOf(head(id))), lord && territory(lord) === id ? 0.12 : 0.03];
    });
    drawBorders();
    ring.set(set ? [...outline(new Map([...depth])), ...[...depth.keys()].flatMap((id) => coastOf().get(id) ?? [])] : []); // the focused realm's whole outline: its borders and its shore, in one colour
    if (set) { const [cr, cg, cb] = edge(vivid(rgbOf(focusId!))); ring.color(`rgb(${cr},${cg},${cb})`); } // the focused house's colour, saturated
    drawHover();
    version++;
  };
  const refreshGraph = () => { for (const s of sigils) s.tier = tierOf(graph, s.id); paint(); };

  const houseAt = (lat: number, lon: number) => {
    for (const [id, b] of bounds) {
      if (lon < b[0] || lon > b[1] || lat < b[2] || lat > b[3]) continue;
      if (T.houses[id].reduce((odd, rg) => (inRing(lon, lat, rg) ? !odd : odd), false)) return id;
    }
    return null;
  };

  // A click (not a drag) on the ground lights the house there; a click on the sea or off the houses clears it.
  let down: { x: number; y: number; t: number } | null = null;
  o.dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  o.dom.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (!group.visible || o.blocked() || !d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 500) return;
    const hit = o.pick(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
    const id = hit ? houseAt(hit.lat, hit.lon) : null;
    if (id) o.onPick(id); else api.focus(null);
  });

  // Over the land the cursor is a pointer and the house under it takes a little colour; checked once a frame at most, and not while dragging.
  let moved: PointerEvent | null = null;
  const drawHover = () => {
    if (!built) return;
    const { width: w, height: h } = hoverCtx.canvas, [lon0, , , lat1] = paintBox;
    hoverCtx.clearRect(0, 0, w, h);
    hoverMesh.visible = !!hoverId;
    if (hoverId) {
      const [cr, cg, cb] = vivid(rgbOf(focusId && graph.subtree(focusId).has(hoverId) ? focusId : graph.by.has(hoverId) ? graph.realm(hoverId) : hoverId));
      hoverCtx.filter = `blur(${BLUR[0]}px)`;
      hoverCtx.beginPath();
      for (const rg of T.houses[hoverId] ?? []) rg.forEach(([x, y], i) => (i ? hoverCtx.lineTo : hoverCtx.moveTo).call(hoverCtx, (x - lon0) * PPD, (lat1 - y) * PPD));
      hoverCtx.fillStyle = `rgba(${cr},${cg},${cb},${HOVER_ALPHA})`;
      hoverCtx.fill('evenodd');
      hoverCtx.filter = 'none';
    }
    hoverTex.needsUpdate = true;
    version++;
  };
  // Asked for freely (the land, a sigil, leaving), applied once a frame: moving from one house onto the next one's sigil
  // is a leave then an enter, and only the last answer counts, so nothing flashes in between.
  let wanted: string | null = null, wantQueued = false;
  const setHover = (id: string | null) => {
    wanted = id;
    if (wantQueued) return;
    wantQueued = true;
    requestAnimationFrame(() => {
      wantQueued = false;
      o.dom.style.cursor = wanted ? 'pointer' : '';
      if (wanted !== hoverId) { hoverId = wanted; drawHover(); }
    });
  };
  o.dom.addEventListener('pointermove', (e) => {
    if (!moved) requestAnimationFrame(() => {
      const ev = moved!; moved = null;
      if (!group.visible || !built || down || o.blocked()) return setHover(null);
      const hit = o.pick(new THREE.Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1));
      setHover(hit ? houseAt(hit.lat, hit.lon) : null);
    });
    moved = e;
  });
  o.dom.addEventListener('pointerleave', () => setHover(null));
  onPeriod(() => { graph = buildGraph(HOUSES, (h) => liegeAt(h.id)); if (built) { if (focusId && !graph.by.has(focusId)) focusId = null; refreshGraph(); o.onFocus(focusId); } });

  const cam = new THREE.Vector3(), v = new THREE.Vector3();
  const api = {
    object: group,
    get visible() { return group.visible; },
    get focused() { return focusId; },
    get graph() { return graph; },
    /** The place name of the focused house's seat (null when none is focused). */
    get seat() { return focusId ? graph.by.get(focusId)?.seat ?? null : null; },
    /** Bumped when what is lit changes, so the label pass can run again. */
    get version() { return version; },
    houseAt,
    setVisible(on: boolean) {
      if (on && !built) build();
      group.visible = on;
      if (!on) api.focus(null);
      version++;
    },
    focus(id: string | null) {
      if (id === focusId) return;
      focusId = id;
      if (built) paint();
      o.onFocus(id);
    },
    /** The land of a house and everyone sworn to it, as [lon, lat] points to frame. */
    extent: (id: string) => [...graph.subtree(id).keys()].flatMap((h) => (T.houses[territory(h)] ?? []).flat()),
    /** The houses lit now (the focused one and everyone sworn to it), with their steps down. */
    lit: () => (focusId ? graph.subtree(focusId) : null),
    /**
     * Once a frame: line fades and the coats of arms (by size class and room). `reserved` is screen taken already (the seat's
     * name); a coat of arms with no room on its land is drawn off it in rings of half its height, on a leader line (declutter RINGS).
     */
    update(camera: THREE.Camera, alt: number, cosLimit: number, now: number, reserved: number[][] = []) {
      if (!group.visible || !built) return;
      const f = 1 - THREE.MathUtils.smoothstep(alt, THIN_BELOW[0], THIN_BELOW[1]);
      if (f !== thinFade) { thinFade = f; thinLines.forEach((l) => l.fade(f)); }
      cam.copy(camera.position).normalize();
      const lit = focusId ? graph.subtree(focusId) : null, taken = createDeclutter(2, 2);
      reserved.forEach((b) => taken.claim(b, true));
      const order = [...sigils].sort((a, b) => Number(lit?.has(b.id) ?? 0) - Number(lit?.has(a.id) ?? 0) || a.tier - b.tier);
      for (const s of order) {
        const isLit = !!lit?.has(s.id);
        let on = isLit ? alt < SIGIL_BELOW[0] : alt < SIGIL_BELOW[s.tier];
        if (on && cam.dot(s.up) <= cosLimit) on = false;
        if (on) {
          v.copy(s.pos).project(camera);
          const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight, k = s.id === focusId ? 1.3 : 1, w = (Math.max(SIGIL_PX[s.tier], s.chars * (s.tier ? 7.5 : 8.7)) * k) / 2, h = ((SIGIL_PX[s.tier] + 20) * k) / 2; // ~0.6 em a letter plus .04em spacing, 12 or 14 px (style.css) // the sigil and the name under it
          const r = v.z < 1 ? RINGS.find(([a, b]) => taken.claim([x + a * h - w, y + b * h - h, x + a * h + w, y + b * h + h])) : undefined;
          on = !!r;
          if (r && (r[0] * h !== s.dx || r[1] * h !== s.dy)) { s.dx = r[0] * h; s.dy = r[1] * h; offset(s.obj.element, s.dx, s.dy); }
        }
        s.obj.element.classList.toggle('lit', isLit);
        s.obj.element.classList.toggle('focus', s.id === focusId); // the house itself: white, larger
        s.obj.element.dataset.tier = String(s.tier);
        setShown(s.obj, on, now);
      }
    },
  };
  return api;
}

export type HouseLayer = ReturnType<typeof createHouseLayer>;
