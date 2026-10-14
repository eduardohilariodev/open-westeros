// Recursively downloads every file in a MediaWiki category (and its subcategories).
// Usage: node tools/world/fetch-awoiaf-maps.mjs [Category:Name] [outDir]
// If the site shows a Cloudflare challenge, copy your browser's Cookie header
// (DevTools > Network > any request to awoiaf.westeros.org) into the COOKIE env var:
//   $env:COOKIE = '...'; node tools/world/fetch-awoiaf-maps.mjs
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

const HOST = 'https://awoiaf.westeros.org'
const root = process.argv[2] ?? 'Category:SVG maps of the known world'
const out = process.argv[3] ?? 'tools/world/maps'
const headers = {
  'User-Agent': 'Mozilla/5.0 (open-westeros map fetcher)',
  ...(process.env.COOKIE && { Cookie: process.env.COOKIE }),
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const safe = (s) => s.replace(/^(Category|File):/, '').replace(/[<>:"/\\|?*]/g, '_')

async function get(url, asJson = true) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return asJson ? res.json() : Buffer.from(await res.arrayBuffer())
}

async function api(params) {
  const q = new URLSearchParams({ format: 'json', ...params })
  return get(`${HOST}/api.php?${q}`)
}

async function members(cat) {
  const files = [], subcats = []
  let cont = {}
  do {
    const d = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: '500', cmtype: 'file|subcat', ...cont })
    for (const m of d.query.categorymembers) (m.ns === 14 ? subcats : files).push(m.title)
    cont = d.continue ?? null
  } while (cont)
  return { files, subcats }
}

async function fileUrls(titles) {
  const urls = {}
  for (let i = 0; i < titles.length; i += 50) {
    const d = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url', titles: titles.slice(i, i + 50).join('|') })
    for (const p of Object.values(d.query.pages)) if (p.imageinfo?.[0]) urls[p.title] = p.imageinfo[0].url
  }
  return urls
}

const seen = new Set()
async function walk(cat, dir) {
  if (seen.has(cat)) return
  seen.add(cat)
  await mkdir(dir, { recursive: true })
  const { files, subcats } = await members(cat)
  console.log(`${cat}: ${files.length} files, ${subcats.length} subcategories`)
  const urls = await fileUrls(files)
  for (const [title, url] of Object.entries(urls)) {
    const dest = join(dir, safe(title))
    if (await access(dest).then(() => true, () => false)) continue
    await writeFile(dest, await get(url.startsWith('http') ? url : HOST + url, false))
    console.log('  saved', dest)
    await sleep(500)
  }
  for (const sub of subcats) await walk(sub, join(dir, safe(sub)))
}

await walk(root, join(out, safe(root)))
console.log('done')
