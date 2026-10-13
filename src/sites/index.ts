import type * as THREE from 'three';
import type { SiteId } from '../config';
import type { SiteView } from './SiteScene';
import { createKingsLandingView } from './kingsLanding/KingsLandingView';
import { createWinterfellView } from './winterfell/WinterfellView';

// To add a site: give it map coordinates in SITES (src/config.ts), write a view module, register it here.
export const SITE_VIEWS: Record<SiteId, (renderer: THREE.WebGLRenderer, labelsEl: HTMLElement) => Promise<SiteView>> = {
  kingsLanding: createKingsLandingView,
  winterfell: createWinterfellView,
};
