import characterData from './characters.json';
import wiki from './character-wiki.json'; // tools/wiki/character-info.mjs
import type { Character } from './globe/characterPath';

/** What the wiki says of a character (from its article); every field is optional until the scrape has run. */
export interface CharacterInfo { image?: string; summary?: string; facts?: [string, string][]; more?: boolean }
export const CHARACTERS = characterData.characters as unknown as Character[];
/** The chapters by index, as the character steps count them (src/chapters.json). */
export { CHAPTERS } from './state/time';
export const CHARACTER_INFO = wiki as Record<string, CharacterInfo>;
