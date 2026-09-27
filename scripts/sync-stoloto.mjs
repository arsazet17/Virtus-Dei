import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_JWT = process.env.SUPABASE_ANON_JWT;
const STOLOTO_LOGIN = process.env.STOLOTOLOGIN || '';
const STOLOTO_PASSWORD = process.env.STOLOTOPASSWORD || '';

if (!SUPABASE_URL || !SUPABASE_ANON_JWT) throw new Error('Supabase env is missing');
if (!STOLOTO_LOGIN || !STOLOTO_PASSWORD) throw new Error('Stoloto GitHub Secrets are missing');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: 'ru-RU' });
const jsonResponses = [];

page.on('response', async (res) => {
  try {
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    jsonResponses.push({ url: res.url(), data });
  } catch {}
});

function isKeno20(arr) {
  return Array.isArray(arr) && arr.length === 20 && new Set(arr.map(Number)).size === 20 && arr.every(v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 80);
}

function findDrawNumber(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const [k,v] of Object.entries(obj)) {
    if (!/(draw|drawnumber|draw_number|circulation|tirazh|number|num)/i.test(k)) continue;
    const n = Number(String(v).replace(/\D/g,''));
    if (Number.isInteger(n) && n > 100000 && n < 10000000) return n;
  }
  return null;
}

function collectCandidates(node, inheritedDraw = null, out = []) {
  if (node == null) return out;
  if (Array.isArray(node)) {
    if (isKeno20(node) && inheritedDraw) out.push({ draw_number: inheritedDraw, result_numbers: node.map(Number) });
    for (const item of node) collectCandidates(item, inheritedDraw, out);
    return out;
  }
  if (typeof node !== 'object') return out;

  const localDraw = findDrawNumber(node) || inheritedDraw;
  for (const [k,v] of Object.entries(node)) {
    if (isKeno20(v) && localDraw) {
      out.push({ draw_number: localDraw, result_numbers: v.map(Number), field:k });
    }
  }
  for (const v of Object.values(node)) collectCandidates(v, localDraw, out);
  return out;
}

function parseCurrentDraw(text) {
  const m = text.match(/Тираж\s*№\s*([0-9]{5,})/i);
  return m ? Number(m[1]) : null;
}

await page.goto('https://www.stoloto.ru/keno2/game', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(5000);
const currentText = await page.locator('body').innerText();
const currentDraw = parseCurrentDraw(currentText);
console.log('Current draw detected:', currentDraw);

jsonResponses.length = 0;
await page.goto('https://www.stoloto.ru/keno2/archive', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(8000);

let candidates = [];
for (const r of jsonResponses) {
  const found = collectCandidates(r.data);
  for (const item of found) candidates.push({ ...item, source_url:r.url });
}

candidates = candidates
  .filter(x => !currentDraw || x.draw_number < currentDraw)
  .filter((x,i,a) => a.findIndex(y => y.draw_number === x.draw_number && JSON.stringify(y.result_numbers) === JSON.stringify(x.result_numbers)) === i)
  .sort((a,b) => b.draw_number - a.draw_number);

let picked = candidates[0] || null;

if (!picked) {
  const text = await page.locator('body').innerText();
  const drawMatches = [...text.matchAll(/(?:№\s*)?([0-9]{6})/g)].map(m => Number(m[1]));
  for (const drawNumber of drawMatches) {
    if (currentDraw && drawNumber >= currentDraw) continue;
    const marker = text.indexOf(String(drawNumber));
    if (marker < 0) continue;
    const chunk = text.slice(marker + String(drawNumber).length, marker + String(drawNumber).length + 1200);
    const tokens = chunk.match(/\b(?:[1-9]|[1-7]\d|80)\b/g)?.map(Number) || [];
    for (let i = 0; i <= tokens.length - 20; i++) {
      const arr = tokens.slice(i, i + 20);
      if (isKeno20(arr)) {
        picked = { draw_number: drawNumber, result_numbers: arr, source_url: page.url(), field:'text-fallback' };
        break;
      }
    }
    if (picked) break;
  }
}

if (!picked) {
  console.log('JSON response URLs:', jsonResponses.map(x => x.url).slice(0,50));
  throw new Error('No completed KENO draw with 20 unique numbers was parsed');
}

await browser.close();

const payload = {
  draw_number: picked.draw_number,
  draw_time: new Date().toISOString(),
  result_numbers: picked.result_numbers,
  source: 'stoloto',
  raw: {
    captured_at: new Date().toISOString(),
    parser: 'playwright-v0.2',
    source_url: picked.source_url,
    source_field: picked.field || null,
    current_draw_seen: currentDraw
  }
};

console.log('Parsed draw:', payload.draw_number, payload.result_numbers.join(','));

const res = await fetch(`${SUPABASE_URL}/functions/v1/draw-ingest`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    apikey: SUPABASE_ANON_JWT,
    authorization: `Bearer ${SUPABASE_ANON_JWT}`
  },
  body: JSON.stringify(payload)
});
const body = await res.text();
if (!res.ok) throw new Error(`draw-ingest ${res.status}: ${body}`);
console.log(body);
