import characterData from './characters.json';
import wiki from './character-wiki.json'; // tools/wiki/character-info.mjs
import type { Character } from './globe/characterPath';
import { chapterLimit } from './state/time';

/** What the wiki says of a character (from its article); every field is optional until the scrape has run. */
export interface CharacterInfo { image?: string; summary?: string; facts?: [string, string][]; more?: boolean }
export const CHARACTERS = characterData.characters as unknown as Character[];
/** The chapters by index, as the character steps count them (src/chapters.json). */
export { CHAPTERS } from './state/time';
/** The character as the moment knows them: the steps that have begun by its chapter, none before the books. */
export const known = (c: Character): Character => { const at = chapterLimit(); return { ...c, steps: c.steps.filter((s) => s.chapters[0] <= at) }; };
export const CHARACTER_INFO = wiki as unknown as Record<string, CharacterInfo>;
