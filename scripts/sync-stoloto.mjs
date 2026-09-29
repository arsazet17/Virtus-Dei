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
const RU_MONTHS = {января:1,февраля:2,марта:3,апреля:4,мая:5,июня:6,июля:7,августа:8,сентября:9,октября:10,ноября:11,декабря:12};
if (!SUPABASE_URL || !SUPABASE_ANON_JWT) throw new Error('Supabase env is missing');
if (!STOLOTO_LOGIN || !STOLOTO_PASSWORD) throw new Error('Stoloto credentials are missing');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function isKeno20(arr) { const nums = Array.isArray(arr) ? arr.map(Number) : []; return nums.length === 20 && new Set(nums).size === 20 && nums.every(v => Number.isInteger(v) && v >= 1 && v <= 80); }
function findDrawNumber(obj) { if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null; for (const [k,v] of Object.entries(obj)) { if (!/(draw|drawnumber|draw_number|circulation|tirazh|number|num)/i.test(k)) continue; const n=Number(String(v??'').replace(/\D/g,'')); if(Number.isInteger(n)&&n>100000&&n<10000000)return n;} return null; }
function findDrawTime(obj) { if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null; for(const[k,v]of Object.entries(obj)){if(!/(date|time|draw_at|drawtime|draw_time)/i.test(k))continue;const d=new Date(v);if(!Number.isNaN(d.getTime()))return d.toISOString();}return null;}
function collectCandidates(node,inherited={},out=[]){if(node==null)return out;if(Array.isArray(node)){if(isKeno20(node)&&inherited.draw_number)out.push({...inherited,result_numbers:node.map(Number)});for(const item of node)collectCandidates(item,inherited,out);return out;}if(typeof node!=='object')return out;const local={draw_number:findDrawNumber(node)||inherited.draw_number||null,draw_time:findDrawTime(node)||inherited.draw_time||null};for(const[field,value]of Object.entries(node))if(isKeno20(value)&&local.draw_number)out.push({...local,result_numbers:value.map(Number),field});for(const value of Object.values(node))collectCandidates(value,local,out);return out;}
function parseCurrentDraw(text){const m=String(text||'').match(/(?:Тираж|тираж)\s*№?\s*([0-9]{5,})/i);return m?Number(m[1]):null;}
function parseColumn(text){const m=String(text||'').replace(/\u00a0/g,' ').match(/столб(?:ец)?\s*[:№#-]?\s*([1-9]|10)\b/i);return m?Number(m[1]):null;}
function columnMap(text,currentDraw){const src=String(text||'').replace(/\u00a0/g,' ');const ms=[...src.matchAll(/(?:№\s*)?([0-9]{6})/g)];const map=new Map();for(let i=0;i<ms.length;i++){const draw=Number(ms[i][1]);if(currentDraw&&draw>=currentDraw)continue;const start=ms[i].index??0;const end=i+1<ms.length?(ms[i+1].index??start+2500):Math.min(src.length,start+2500);const col=parseColumn(src.slice(start,end));if(col)map.set(draw,col);}return map;}
function moscowToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t)?.value;return{year:Number(get('year')),month:Number(get('month')),day:Number(get('day'))};}
function parseArchiveDrawTime(source,marker){const src=String(source||'').replace(/\u00a0/g,' ');const start=Math.max(0,marker-260);const before=src.slice(start,marker);const around=src.slice(start,Math.min(src.length,marker+180));let times=[...before.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];let tm=times.at(-1);if(!tm)tm=around.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);if(!tm)return null;let year,month,day;const numeric=[...before.matchAll(/\b(0?[1-9]|[12]\d|3[01])[.\/-](0?[1-9]|1[0-2])[.\/-](20\d{2})\b/g)].at(-1);if(numeric){day=Number(numeric[1]);month=Number(numeric[2]);year=Number(numeric[3]);}else{const words=[...before.matchAll(/\b(0?[1-9]|[12]\d|3[01])\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(20\d{2}))?/gi)].at(-1);if(words){day=Number(words[1]);month=RU_MONTHS[String(words[2]).toLowerCase()];year=words[3]?Number(words[3]):moscowToday().year;}}if(!year||!month||!day){const today=moscowToday();year=today.year;month=today.month;day=today.day;}const hh=String(Number(tm[1])).padStart(2,'0');const mm=String(Number(tm[2])).padStart(2,'0');const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${hh}:${mm}:00+03:00`;return Number.isNaN(new Date(iso).getTime())?null:iso;}
function drawTimeMap(text,currentDraw){const src=String(text||'').replace(/\u00a0/g,' ');const map=new Map();for(const match of src.matchAll(/(?:№\s*)?([0-9]{6})/g)){const draw=Number(match[1]);if(currentDraw&&draw>=currentDraw)continue;const marker=match.index??-1;if(marker<0)continue;const time=parseArchiveDrawTime(src,marker);if(time)map.set(draw,time);}return map;}
function textCandidates(text,currentDraw){const out=[];const source=String(text||'');for(const match of source.matchAll(/(?:№\s*)?([0-9]{6})/g)){const drawNumber=Number(match[1]);if(currentDraw&&drawNumber>=currentDraw)continue;const marker=match.index??-1;if(marker<0)continue;const chunk=source.slice(marker+match[0].length,marker+match[0].length+1600);const tokens=chunk.match(/\b(?:[1-9]|[1-7]\d|80)\b/g)?.map(Number)||[];for(let i=0;i<=tokens.length-20;i++){const arr=tokens.slice(i,i+20);if(isKeno20(arr)){out.push({draw_number:drawNumber,draw_time:parseArchiveDrawTime(source,marker),result_numbers:arr,field:'text-fallback'});break;}}}return out;}
function uniqueCandidates(items,currentDraw){const seen=new Set();return items.filter(x=>Number.isInteger(Number(x.draw_number))&&isKeno20(x.result_numbers)).filter(x=>!currentDraw||Number(x.draw_number)<currentDraw).map(x=>({...x,draw_number:Number(x.draw_number),result_numbers:x.result_numbers.map(Number)})).filter(x=>{const key=`${x.draw_number}:${x.result_numbers.join(',')}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>b.draw_number-a.draw_number);}
async function firstVisible(page,selectors){for(const selector of selectors)for(const frame of page.frames())try{const loc=frame.locator(selector).first();if(await loc.count()&&await loc.isVisible())return{frame,loc};}catch{}return null;}
async function login(page){await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:90000});const deadline=Date.now()+20000;let user=null,pass=null;while(Date.now()<deadline&&(!user||!pass)){user=await firstVisible(page,['input[type="email"]','input[name*="email" i]','input[name*="login" i]','input[autocomplete="username"]','input[type="text"]']);pass=await firstVisible(page,['input[type="password"]','input[name*="password" i]','input[autocomplete="current-password"]']);if(!user||!pass)await sleep(250);}if(!user||!pass){await page.screenshot({path:'stoloto-oauth-debug.png',fullPage:true}).catch(()=>{});await fs.writeFile('stoloto-oauth-debug.json',JSON.stringify({at:new Date().toISOString(),url:page.url(),error:'OAuth fields not found'},null,2));throw new Error('Stoloto OAuth fields were not found');}await user.loc.fill(STOLOTO_LOGIN);await pass.loc.fill(STOLOTO_PASSWORD);let submitted=false;for(const frame of page.frames()){for(const selector of ['button[type="submit"]','input[type="submit"]'])try{const b=frame.locator(selector).first();if(await b.count()&&await b.isVisible()){await b.click();submitted=true;break;}}catch{}if(submitted)break;}if(!submitted)for(const frame of page.frames())try{const b=frame.getByRole('button',{name:/войти/i}).first();if(await b.count()&&await b.isVisible()){await b.click();submitted=true;break;}}catch{}if(!submitted)throw new Error('Stoloto OAuth submit button was not found');await page.waitForLoadState('domcontentloaded',{timeout:30000}).catch(()=>{});await sleep(3500);}
async function detectCurrentDraw(page){await page.goto(GAME_URL,{waitUntil:'domcontentloaded',timeout:90000});await sleep(4000);return parseCurrentDraw(await page.locator('body').innerText().catch(()=>''));}
function parseDateLabel(label) {
  const raw=String(label||'').trim().toLowerCase();
  const today=moscowToday();
  let year=today.year,month=today.month,day=today.day;
  if(raw==='вчера') {
    const d=new Date(Date.UTC(year,month-1,day-1));
    year=d.getUTCFullYear();month=d.getUTCMonth()+1;day=d.getUTCDate();
  } else if(raw!=='сегодня') {
    const numeric=raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/);
    const words=raw.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/);
    if(numeric){day=+numeric[1];month=+numeric[2];year=+numeric[3];if(year<100)year+=2000;}
    else if(words&&RU_MONTHS[words[2]]){day=+words[1];month=RU_MONTHS[words[2]];if(words[3])year=+words[3];else if(month>today.month+6)year--;}
    else return null;
  }
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||d.getUTCDate()!==day)return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function parseDomRows(rows,currentDraw) {
  const out=[];
  for(const row of rows){
    const id=String(row.text||'').match(/№\s*(\d{6})\b/);
    const time=String(row.text||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const date=parseDateLabel(row.dateLabel);
    const column=parseColumn(row.context||row.text);
    if(!id||!time||!date||!column)continue;
    const draw_number=Number(id[1]);
    if(currentDraw&&draw_number>=currentDraw)continue;
    const draw_time=`${date}T${time[1].padStart(2,'0')}:${time[2]}:00+03:00`;
    if(Date.parse(draw_time)>Date.now()+300000)continue;
    let result_numbers=null;
    for(const pool of [row.buttons||[],row.atoms||[]]){
      const nums=pool.map(x=>String(x).trim()).filter(x=>/^0?(?:[1-9]|[1-7]\d|80)$/.test(x)).map(Number);
      if(isKeno20(nums)){result_numbers=nums;break;}
    }
    // Never slide a 20-number window over page text: time, prizes and counts are not balls.
    if(!result_numbers)continue;
    out.push({draw_number,draw_time,column,result_numbers,field:'dom-balls'});
  }
  return uniqueCandidates(out,currentDraw);
}
async function readArchiveOnce(page,currentDraw){
  let usedUrl='';
  for(const url of ARCHIVE_URLS){
    usedUrl=url;
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
      await page.waitForFunction(()=>/№\s*\d{6}/.test(document.body?.innerText||''),{},{timeout:30000});
      await sleep(2500);
      const rows=await page.locator('body').evaluate(()=>{
        const norm=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
        const drawRx=/№\s*\d{6}/;
        const dateRx=/^(Сегодня|Вчера|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)$/i;
        const all=[...document.querySelectorAll('body *')];
        function dateBefore(el){let best='';for(const n of all){if(n===el||el.contains(n))continue;if(!(n.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))continue;const t=norm(n.innerText||n.textContent);if(t&&t.length<40&&dateRx.test(t))best=t;}return best;}
        let rows=[...document.querySelectorAll('tr')].filter(el=>drawRx.test(el.innerText||''));
        if(!rows.length)rows=all.filter(el=>drawRx.test(norm(el.innerText))&&![...el.children].some(ch=>drawRx.test(norm(ch.innerText))));
        return rows.map(el=>{
          const chunks=[];const add=n=>{if(n){const t=norm(n.innerText||n.textContent);if(t)chunks.push(t);}};
          add(el);let p=el.parentElement;
          for(let i=0;p&&i<4;i++,p=p.parentElement){add(p);if(/столб/i.test(chunks.join(' ')))break;}
          add(el.previousElementSibling);add(el.nextElementSibling);
          return {text:norm(el.innerText),context:chunks.join('\n'),dateLabel:dateBefore(el),buttons:[...el.querySelectorAll('button')].map(x=>norm(x.innerText||x.textContent)),atoms:[...el.querySelectorAll('[class*="ball" i],[class*="number" i],[class*="win" i]')].map(x=>norm(x.innerText||x.textContent))};
        });
      });
      const parsed=parseDomRows(rows,currentDraw);
      if(parsed.length)return parsed.slice(0,10).map(x=>({...x,source_url:url}));
    }catch(e){console.log(`Archive DOM read failed: ${url}: ${e.message}`);}
  }
  throw new Error(`No completed KENO draw with exactly 20 DOM balls, date and official column from ${usedUrl}`);
}
function chooseConsensus(reads){const votes=new Map();for(let read=0;read<reads.length;read++)for(const item of reads[read]){const key=`${item.draw_number}:${item.result_numbers.join(',')}:${item.column??''}:${item.draw_time??''}`;const entry=votes.get(key)||{item,reads:new Set()};if(!entry.item.draw_time&&item.draw_time)entry.item={...entry.item,draw_time:item.draw_time};entry.reads.add(read);votes.set(key,entry);}const agreed=[...votes.values()].filter(x=>x.reads.size>=2&&x.item.column).sort((a,b)=>b.item.draw_number-a.item.draw_number);if(!agreed.length)throw new Error('No 2-of-3 stable Stoloto draw consensus with official column');return{...agreed[0].item,stable_reads:agreed[0].reads.size};}
const browser=await chromium.launch({headless:true});let picked,currentDraw=null;try{const context=await browser.newContext({locale:'ru-RU',timezoneId:'Europe/Moscow',viewport:{width:390,height:844}});const page=await context.newPage();await login(page);currentDraw=await detectCurrentDraw(page);console.log('Current Stoloto draw:',currentDraw);const reads=[];for(let i=0;i<READS;i++){const batch=await readArchiveOnce(page,currentDraw);console.log(`Archive read ${i+1}/${READS}: latest=${batch[0]?.draw_number}, time=${batch[0]?.draw_time||'NONE'}, column=${batch[0]?.column}, count=${batch.length}`);reads.push(batch);if(i<READS-1)await sleep(900);}picked=chooseConsensus(reads);}finally{await browser.close();}
const payload={draw_number:picked.draw_number,draw_time:picked.draw_time||null,result_numbers:picked.result_numbers,column:picked.column,source:'stoloto-oauth',raw:{captured_at:new Date().toISOString(),parser:'virtus-dom-balls-2of3-v4',source_url:picked.source_url||null,source_field:picked.field||null,current_draw_seen:currentDraw,stable_reads:picked.stable_reads,official_column:picked.column,official_draw_time:picked.draw_time||null}};
console.log('Confirmed draw:',payload.draw_number,'OFFICIAL TIME:',payload.draw_time,'OFFICIAL COLUMN:',payload.column,payload.result_numbers.join(','));
const res=await fetch(`${SUPABASE_URL}/functions/v1/draw-ingest`,{method:'POST',headers:{'content-type':'application/json',apikey:SUPABASE_ANON_JWT,authorization:`Bearer ${SUPABASE_ANON_JWT}`},body:JSON.stringify(payload)});const body=await res.text();if(!res.ok)throw new Error(`draw-ingest ${res.status}: ${body}`);console.log(body);
