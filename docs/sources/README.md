# Sources

What we read the world from, filed by what each source is. The shelf order is the trust order from `CLAUDE.md`: a higher shelf beats a lower one, and a disagreement goes in `docs/lore-conflicts.md`.

Everything here except `atlas-blog/` and this file is git-ignored and local only. The last column says how to rebuild it.

| Shelf | Folder | What it is | Canon | Rebuild |
|---|---|---|---|---|
| 1 | `books/` | George R. R. Martin's prose: `a-song-of-ice-and-fire-1-5.epub` (the five novels), `a-knight-of-the-seven-kingdoms.epub`, `fire-and-blood.epub`, `world-of-ice-and-fire.pdf`. `text/` holds one plain-text file per book, named by the same slug (`node tools/books/extract.mjs`). `places.json` is our index of place mentions in them (`node tools/books/place-index.mjs`) | yes | your own copies |
| 1 | `maps/` | *The Lands of Ice and Fire* (2012), the official map sheets, used for road courses (`tools/books/liaf-*.mjs`) | yes, for positions | your own copy |
| 2 | `wiki/` | A Wiki of Ice and Fire mirror, one Markdown file per page (CC BY-SA) | no, it cites canon | `npm run wiki` |
| 3 | `atlas-blog/` | The Atlas of Ice and Fire blog: posts and their images (tracked) | no | `node tools/blog/scrape.mjs` |
| 4 | `quartermaester/` | quartermaester.info character paths, plus our fit of them to this map (`qm-mapped.json`) | no, a reading of the novels | `node tools/characters/qm-extract.mjs` |
| - | `criticism/` | *Beyond the Wall* (2012), essays about the books by other authors. Kept out of `books/text` so `lore find` never cites it as canon | no | your own copy |
| - | `screen/` | The HBO shows. `hbo-scripts/`: shooting-script PDFs from scriptslug.com (5 GoT, 1 HotD). `genius-transcripts/`: Genius transcripts of all 73 GoT episodes, one `.txt` each | no, never used to place things | by hand |

A file is named by its slug: lower case, hyphens, no edition or shop tags. `extract.mjs` relies on that: the slug of the book file becomes the slug of its text.
