import type { Period } from './state/time';

// Who holds of whom at one moment (src/houses.json, tools/wiki/houses.mjs; the liege at a moment from state/changes.ts). Pure data, no rendering.
export interface House {
  id: string; name: string; title: string; sigil: string; seat: string;
  region?: string; head?: string; words?: string; seatOf?: string;
  liege: Record<Period, string | null>;
}

/** `liege` gives the id of the house a house is sworn to, or null. */
export function buildGraph(houses: House[], liege: (h: House) => string | null) {
  const by = new Map(houses.map((h) => [h.id, h]));
  const lieges = new Map(houses.map((h) => [h.id, liege(h)]));
  const sworn = new Map<string, House[]>();
  for (const h of houses) {
    const l = lieges.get(h.id);
    if (l && by.has(l)) sworn.set(l, [...(sworn.get(l) ?? []), h]);
  }
  const liegeOf = (id: string) => { const l = lieges.get(id); return l ? by.get(l) ?? null : null; };
  /** The houses sworn directly to `id`. */
  const vassals = (id: string) => sworn.get(id) ?? [];
  /** `id` and everyone sworn to it, nested, with how many steps down each is (0 = the house itself). */
  const subtree = (id: string) => {
    const depth = new Map<string, number>([[id, 0]]);
    for (let queue = [id]; queue.length;) {
      const next: string[] = [];
      for (const q of queue) for (const v of vassals(q)) if (!depth.has(v.id)) { depth.set(v.id, depth.get(q)! + 1); next.push(v.id); }
      queue = next;
    }
    return depth;
  };
  /** The great lord a house answers to: the highest house in its chain that still has a liege of its own (the crown has none). */
  const realm = (id: string) => {
    let h = by.get(id)!;
    for (const seen = new Set([id]); ;) {
      const l = liegeOf(h.id);
      if (!l || !liegeOf(l.id) || seen.has(l.id)) return h.id;
      seen.add(l.id); h = l;
    }
  };
  return { by, vassals, subtree, liegeOf, realm };
}

export type Graph = ReturnType<typeof buildGraph>;

/** Sigil size class: great houses hold many vassals. */
export const tierOf = (g: Graph, id: string) => { const n = g.subtree(id).size - 1; return n >= 12 ? 0 : n >= 3 ? 1 : 2; };
