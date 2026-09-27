import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_JWT = process.env.SUPABASE_ANON_JWT;
const STOLOTO_LOGIN = process.env.STOLOTOLOGIN || '';
const STOLOTO_PASSWORD = process.env.STOLOTOPASSWORD || '';

if (!SUPABASE_URL || !SUPABASE_ANON_JWT) throw new Error('Supabase env is missing');
if (!STOLOTO_LOGIN || !STOLOTO_PASSWORD) throw new Error('Stoloto GitHub Secrets are missing');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: 'ru-RU' });

function parseLatestDraw(text) {
  const m = text.match(/Тираж\s*№\s*([0-9]{5,})[^0-9]{0,40}([0-2]?\d:[0-5]\d)/i);
  if (!m) throw new Error('Cannot detect current KENO draw number');
  return { current: Number(m[1]), time: m[2] };
}

function findTwentyNumbersNear(text, drawNumber) {
  const marker = new RegExp(`(?:№\\s*)?${drawNumber}\\b`);
  const m = marker.exec(text);
  if (!m) return null;
  const chunk = text.slice(m.index + m[0].length, m.index + m[0].length + 1800);
  const tokens = chunk.match(/\b(?:[1-9]|[1-7]\d|80)\b/g)?.map(Number) || [];
  for (let i = 0; i <= tokens.length - 20; i++) {
    const arr = tokens.slice(i, i + 20);
    if (new Set(arr).size === 20) return arr;
  }
  return null;
}

await page.goto('https://www.stoloto.ru/keno2/game', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(5000);
const gameText = await page.locator('body').innerText();
const { current } = parseLatestDraw(gameText);

let payload = null;
for (const drawNumber of [current - 1, current - 2, current - 3]) {
  try {
    await page.goto(`https://www.stoloto.ru/keno2/archive/${drawNumber}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(4000);
    const text = await page.locator('body').innerText();
    const nums = findTwentyNumbersNear(text, drawNumber);
    if (nums?.length === 20) {
      payload = {
        draw_number: drawNumber,
        draw_time: new Date().toISOString(),
        result_numbers: nums,
        source: 'stoloto',
        raw: { url: page.url(), captured_at: new Date().toISOString(), parser: 'playwright-v0.1' }
      };
      break;
    }
  } catch (e) {
    console.warn(`Draw ${drawNumber} parse failed:`, e.message);
  }
}

await browser.close();
if (!payload) throw new Error('No completed KENO draw with 20 unique numbers was parsed');

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
