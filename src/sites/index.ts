import type * as THREE from 'three';
import type { SiteId } from '../config';
import type { SiteView } from './SiteScene';
import { createKingsLandingView } from './kingsLanding/KingsLandingView';
import { createWinterfellView } from './winterfell/WinterfellView';

// To add a site: add it to SITES (src/config.ts) and to the places table (tools/world/places.raw.txt), write a view module, register it here.
export const SITE_VIEWS: Record<SiteId, (renderer: THREE.WebGLRenderer, labelsEl: HTMLElement) => Promise<SiteView>> = {
  kingsLanding: createKingsLandingView,
  winterfell: createWinterfellView,
};
