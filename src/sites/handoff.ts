import * as THREE from 'three';
import { SITE_LOAD_DISTANCE, SITES, type SiteId } from '../config';
import type { Card, GlobeView } from '../globe/GlobeView';
import { PLACE_KINDS } from '../globe/placeIcons';
import { PLACE_INFO } from '../place-info';
import { SITE_VIEWS } from './index';
import { GLOBE_KIND, type SiteView } from './SiteScene';

const KIND_NAME = Object.fromEntries(PLACE_KINDS.map(([k, , one]) => [k, one]));

// The hand-off between the globe and the 3D places: a place's scene loads on demand as the camera nears it, takes the
// camera's own pose in its local frame, fades in over the last stretch of its draw distance and is drawn over the globe.
export function createSites(renderer: THREE.WebGLRenderer, globe: GlobeView, showCard: (c: Card) => void) {
  const sites: Partial<Record<SiteId, SiteView>> = {};
  const loading: Partial<Record<SiteId, Promise<void>>> = {};
  let drawn: SiteView | null = null, drawnId: SiteId | null = null;

  function load(id: SiteId) {
    return (loading[id] ??= (() => {
      const labels = document.createElement('div'); // one label layer per site, faded in with the site
      labels.className = 'labels';
      document.body.append(labels);
      globe.attachInput(labels); // dragging and zooming over a name steers the globe's camera too
      return SITE_VIEWS[id](renderer, labels).then((view) => {
        view.camera.aspect = innerWidth / innerHeight;
        view.camera.updateProjectionMatrix();
        view.labels.setSize(innerWidth, innerHeight);
        view.onPick = (p) => {
          // the wiki's passage (place-info.ts) when it has one; the hand-written lore is the fallback
          showCard({ kind: KIND_NAME[GLOBE_KIND[p.kind]] ?? p.kind, name: p.name, text: PLACE_INFO[p.name]?.summary ? undefined : view.lore[p.name] });
          const f = view.focus(p);
          globe.flyToSite(id, f.x, f.z, f.alt);
        };
        sites[id] = view;
      });
    })());
  }

  return {
    /** The site the camera is within the draw distance of, if any. */
    drawnId: () => drawnId,
    /** Every site loaded so far (they follow the window's size). */
    views: () => Object.values(sites) as SiteView[],
    /** Once a frame, before the globe is drawn: loads a site on approach and poses and fades the ones in view. Returns true while the drawn site is still loading. */
    update() {
      const near = globe.siteWithin(SITE_LOAD_DISTANCE);
      if (near && !sites[near]) load(near);
      const id = globe.siteWithin((s) => SITES[s].drawDistance) ?? null;
      drawn = id && sites[id] || null;
      drawnId = id;
      for (const [sid, s] of Object.entries(sites) as [SiteId, SiteView][]) {
        if (sid !== id) { s.setFade(0); continue; }
        const c = globe.siteCamera(sid), D = SITES[sid].drawDistance;
        s.camera.position.copy(c.position);
        s.camera.quaternion.copy(c.quaternion);
        s.setFade(1 - THREE.MathUtils.smoothstep(c.position.length(), D * 0.55, D));
      }
      return !!id && !sites[id];
    },
    /** Once a frame, after the globe is drawn: the drawn site over it. */
    render() {
      if (!drawn || drawn.fade <= 0) return;
      renderer.clearDepth(); // the site has its own ground; the globe's depth would hide its low parts under the globe's surface
      renderer.render(drawn.scene, drawn.camera);
      drawn.updateLabels();
      drawn.labels.render(drawn.scene, drawn.camera);
    },
  };
}
