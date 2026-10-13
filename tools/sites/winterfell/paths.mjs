// Where the extracted "The True Winterfell SE" mod lives (see README in assets/sites/winterfell/).
export const DATA = 'assets/sites/winterfell/mod/The True Winterfell SE/Data';
export const ESM = `${DATA}/The True Winterfell.esm`;
export const MESHES = `${DATA}/Meshes`;
export const TEXTURES = `${DATA}/Textures`;
export const OUT = 'public/sites/winterfell';
/** Vanilla Skyrim files the mod uses, copied into the project by collect.mjs (same layout as Data/). */
export const VANILLA = 'assets/sites/winterfell/vanilla';

// Vanilla Skyrim SE install: masters (base objects the mod reuses) and archives (their meshes/textures).
// Override with SKYRIM_DATA=<path to Skyrim Special Edition\Data>.
export const SKYRIM_DATA = process.env.SKYRIM_DATA ?? 'C:/Users/AVELL/scoop/apps/steam/current/steamapps/common/Skyrim Special Edition/Data';
