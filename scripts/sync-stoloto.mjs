import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_JWT = process.env.SUPABASE_ANON_JWT;
const STOLOTO_LOGIN = process.env.STOLOTO_EMAIL || process.env.STOLOTOLOGIN || '';
const STOLOTO_PASSWORD = process.env.STOLOTO_PASSWORD || process.env.STOLOTOPASSWORD || '';

const LOGIN_URL = 'https://oauth.stoloto.ru/login';
const GAME_URL = 'https://www.stoloto.ru/keno2/game';
const ARCHIVE_URLS = ['https://m.stoloto.ru/keno2/archive/', 'https://www.stoloto.ru/keno2/archive'];
const READS = 3;

if (!SUPABASE_URL || !SUPABASE_ANON_JWT) throw new Error('Supabase env is missing');
if (!STOLOTO_LOGIN || !STOLOTO_PASSWORD) throw new Error('Stoloto credentials are missing');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isKeno20(arr) {
  const nums = Array.isArray(arr) ? arr.map(Number) : [];
  return nums.length === 20 &&
    new Set(nums).size === 20 &&
    nums.every(v => Number.isInteger(v) && v >= 1 && v <= 80);
}

function findDrawNumber(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (!/(draw|drawnumber|draw_number|circulation|tirazh|number|num)/i.test(k)) continue;
    const digits = String(v ?? '').replace(/\D/g, '');
    const n = Number(digits);
    if (Number.isInteger(n) && n > 100000 && n < 10000000) return n;
  }
  return null;
}

function findDrawTime(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (!/(date|time|draw_at|drawtime|draw_time)/i.test(k)) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function collectCandidates(node, inherited = {}, out = []) {
  if (node == null) return out;
  if (Array.isArray(node)) {
    if (isKeno20(node) && inherited.draw_number) {
      out.push({
        draw_number: inherited.draw_number,
        draw_time: inherited.draw_time || null,
        result_numbers: node.map(Number),
      });
    }
    for (const item of node) collectCandidates(item, inherited, out);
    return out;
  }
  if (typeof node !== 'object') return out;

  const local = {
    draw_number: findDrawNumber(node) || inherited.draw_number || null,
    draw_time: findDrawTime(node) || inherited.draw_time || null,
  };

  for (const [field, value] of Object.entries(node)) {
    if (isKeno20(value) && local.draw_number) {
      out.push({
        draw_number: local.draw_number,
        draw_time: local.draw_time,
        result_numbers: value.map(Number),
        field,
      });
    }
  }
  for (const value of Object.values(node)) collectCandidates(value, local, out);
  return out;
}

function parseCurrentDraw(text) {
  const m = String(text || '').match(/(?:Тираж|тираж)\s*№?\s*([0-9]{5,})/i);
  return m ? Number(m[1]) : null;
}

function textCandidates(text, currentDraw) {
  const out = [];
  const source = String(text || '');
  const drawMatches = [...source.matchAll(/(?:№\s*)?([0-9]{6})/g)];
  for (const match of drawMatches) {
    const drawNumber = Number(match[1]);
    if (currentDraw && drawNumber >= currentDraw) continue;
    const marker = match.index ?? -1;
    if (marker < 0) continue;
    const chunk = source.slice(marker + match[0].length, marker + match[0].length + 1600);
    const tokens = chunk.match(/\b(?:[1-9]|[1-7]\d|80)\b/g)?.map(Number) || [];
    for (let i = 0; i <= tokens.length - 20; i++) {
      const arr = tokens.slice(i, i + 20);
      if (isKeno20(arr)) {
        out.push({ draw_number: drawNumber, draw_time: null, result_numbers: arr, field: 'text-fallback' });
        break;
      }
    }
  }
  return out;
}

function uniqueCandidates(items, currentDraw) {
  const seen = new Set();
  return items
    .filter(x => Number.isInteger(Number(x.draw_number)) && isKeno20(x.result_numbers))
    .filter(x => !currentDraw || Number(x.draw_number) < currentDraw)
    .map(x => ({ ...x, draw_number: Number(x.draw_number), result_numbers: x.result_numbers.map(Number) }))
    .filter(x => {
      const key = `${x.draw_number}:${x.result_numbers.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.draw_number - a.draw_number);
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    for (const frame of page.frames()) {
      try {
        const loc = frame.locator(selector).first();
        if (await loc.count() && await loc.isVisible()) return { frame, loc };
      } catch {}
    }
  }
  return null;
}

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const deadline = Date.now() + 20000;
  let user = null;
  let pass = null;

  while (Date.now() < deadline && (!user || !pass)) {
    user = await firstVisible(page, [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[name*="login" i]',
      'input[autocomplete="username"]',
      'input[type="text"]'
    ]);
    pass = await firstVisible(page, [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[autocomplete="current-password"]'
    ]);
    if (!user || !pass) await sleep(250);
  }

  if (!user || !pass) {
    await page.screenshot({ path: 'stoloto-oauth-debug.png', fullPage: true }).catch(() => {});
    await fs.writeFile('stoloto-oauth-debug.json', JSON.stringify({
      at: new Date().toISOString(),
      url: page.url(),
      title: await page.title().catch(() => ''),
      error: 'OAuth fields not found'
    }, null, 2));
    throw new Error('Stoloto OAuth fields were not found');
  }

  await user.loc.fill(STOLOTO_LOGIN);
  await pass.loc.fill(STOLOTO_PASSWORD);

  let submitted = false;
  for (const frame of page.frames()) {
    for (const selector of ['button[type="submit"]', 'input[type="submit"]']) {
      try {
        const button = frame.locator(selector).first();
        if (await button.count() && await button.isVisible()) {
          await button.click();
          submitted = true;
          break;
        }
      } catch {}
    }
    if (submitted) break;
  }
  if (!submitted) {
    for (const frame of page.frames()) {
      try {
        const button = frame.getByRole('button', { name: /войти/i }).first();
        if (await button.count() && await button.isVisible()) {
          await button.click();
          submitted = true;
          break;
        }
      } catch {}
    }
  }
  if (!submitted) throw new Error('Stoloto OAuth submit button was not found');

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await sleep(3500);
}

async function detectCurrentDraw(page) {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(4000);
  return parseCurrentDraw(await page.locator('body').innerText().catch(() => ''));
}

async function readArchiveOnce(page, currentDraw) {
  const responses = [];
  const handler = async res => {
    try {
      const ct = String(res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('application/json')) return;
      responses.push({ url: res.url(), data: await res.json() });
    } catch {}
  };
  page.on('response', handler);

  let body = '';
  let usedUrl = '';
  try {
    for (const url of ARCHIVE_URLS) {
      usedUrl = url;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
        await sleep(3000);
        body = await page.locator('body').innerText().catch(() => '');
        if (body && /№\s*\d{5,}/.test(body)) break;
      } catch {}
    }
  } finally {
    page.off('response', handler);
  }

  let candidates = [];
  for (const response of responses) {
    for (const item of collectCandidates(response.data)) {
      candidates.push({ ...item, source_url: response.url });
    }
  }
  for (const item of textCandidates(body, currentDraw)) {
    candidates.push({ ...item, source_url: usedUrl });
  }

  const clean = uniqueCandidates(candidates, currentDraw);
  if (!clean.length) {
    throw new Error(`No completed KENO draw with 20 numbers parsed from ${usedUrl}`);
  }
  return clean.slice(0, 10);
}

function chooseConsensus(reads) {
  const votes = new Map();
  for (let read = 0; read < reads.length; read++) {
    for (const item of reads[read]) {
      const key = `${item.draw_number}:${item.result_numbers.join(',')}`;
      const entry = votes.get(key) || { item, reads: new Set() };
      entry.reads.add(read);
      votes.set(key, entry);
    }
  }
  const agreed = [...votes.values()]
    .filter(x => x.reads.size >= 2)
    .sort((a, b) => b.item.draw_number - a.item.draw_number);

  if (!agreed.length) throw new Error('No 2-of-3 stable Stoloto draw consensus');
  return { ...agreed[0].item, stable_reads: agreed[0].reads.size };
}

const browser = await chromium.launch({ headless: true });
let picked;
let currentDraw = null;
try {
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  await login(page);
  currentDraw = await detectCurrentDraw(page);
  console.log('Current Stoloto draw:', currentDraw);

  const reads = [];
  for (let i = 0; i < READS; i++) {
    const batch = await readArchiveOnce(page, currentDraw);
    console.log(`Archive read ${i + 1}/${READS}: latest=${batch[0]?.draw_number}, count=${batch.length}`);
    reads.push(batch);
    if (i < READS - 1) await sleep(900);
  }
  picked = chooseConsensus(reads);
} finally {
  await browser.close();
}

const payload = {
  draw_number: picked.draw_number,
  draw_time: picked.draw_time || new Date().toISOString(),
  result_numbers: picked.result_numbers,
  source: 'stoloto-oauth',
  raw: {
    captured_at: new Date().toISOString(),
    parser: 'virtus-m5m-oauth-2of3-v1',
    source_url: picked.source_url || null,
    source_field: picked.field || null,
    current_draw_seen: currentDraw,
    stable_reads: picked.stable_reads
  }
};

console.log('Confirmed draw:', payload.draw_number, payload.result_numbers.join(','));

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
