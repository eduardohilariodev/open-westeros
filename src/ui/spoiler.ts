import { atEnd } from '../state/time';

/** The wiki's text is written after the whole story: before its end it waits behind a button. */
export const spoilerSafe = (revealed: boolean) => atEnd() || revealed;
export const spoilerButton = (onShow: () => void) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'spoiler'; b.textContent = 'Show the wiki description (may contain spoilers)';
  b.onclick = onShow;
  return b;
};
