// Markdown helpers for the scraped wiki articles (docs/wiki), shared by place-info.mjs and tools/sites/site-wiki.mjs.
// No citation marks, emphasis or escapes.
export const strip = (md) => md
  .replace(/\\\[[^\]]*\\\]/g, '')
  .replace(/\*\*|(?<!\w)_|_(?!\w)/g, '')
  .replace(/\\(.)/g, '$1')
  .replace(/\s+([,.;:])/g, '$1').trim();
// Markdown -> plain text: link text only.
export const plain = (md) => strip(md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'));
export const parens = (s) => s.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
// Markdown -> text that keeps its wiki links as [text](Page_title#section), the part after awoiaf.westeros.org/index.php/, which the
// panel turns into links. Other links and pictures lose their markup.
export const rich = (md) => {
  const kept = [];
  const text = md.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const doc = href.match(/^(.+?)\.md(#.*)?$/), abs = href.match(/^https:\/\/awoiaf\.westeros\.org\/index\.php\/(.+)$/);
      const target = doc ? parens(decodeURIComponent(doc[1])) + (doc[2] ?? '') : abs?.[1];
      const text = strip(label);
      if (!target || !text) return label;
      kept.push(`[${text}](${target})`);
      return `\u0001${kept.length - 1}\u0002`;
    });
  return strip(text).replace(/\u0001(\d+)\u0002/g, (_, i) => kept[i]);
};
// An article title from a link target ("Great_Keep_%28Winterfell%29" -> "Great Keep (Winterfell)").
export const titleOf = (target) => decodeURIComponent(target.split('#')[0]).replaceAll('_', ' ');
