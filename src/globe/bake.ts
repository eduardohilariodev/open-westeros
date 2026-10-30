import B0 from './relief-bounds.json';

// Which baked maps the globe draws: public/world/ (npm run terrain -- --full), or with ?bake=<name> a test bake from
// public/world-test/<name>/ (npm run terrain -- --out <name>, a window too), to compare bakes in the same shader.
const name = new URLSearchParams(location.search).get('bake');
export const BAKE_DIR = `${import.meta.env.BASE_URL}${name ? `world-test/${name}` : 'world'}/`;
export const B: typeof B0 = name ? await fetch(`${BAKE_DIR}relief-bounds.json`).then((r) => r.json()) : B0;
