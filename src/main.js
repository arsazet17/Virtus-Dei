import './style.css'
import { uploadScreenshot } from './services/storage.js'
import { createPendingRecognition, recognizeScreenshot } from './services/recognition.js'
import { supabaseConfigured } from './supabase.js'

const state = { screenshots: [], selectedId: null }
const app = document.querySelector('#app')
app.innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><img class="brand-icon" src="${import.meta.env.BASE_URL}icons/virtus-dei-512.png" alt="Virtus Dei est — id est nobis" width="156" height="156"><b>Virtus Dei est</b><small>id est nobis</small></div>
    <button class="nav active">Главная</button><button class="nav">Загрузка</button><button class="nav">Скриншоты</button><button class="nav">Сравнение</button><button class="nav">Анализ и обучение</button><button class="nav">Архив</button>
  </aside>
  <main>
    <div class="mobile-brand"><img src="${import.meta.env.BASE_URL}icons/virtus-dei-192.png" alt="" width="64" height="64"><div><b>Virtus Dei est</b><small>id est nobis</small></div></div>
    <header><div><small>Следующий тираж</small><h2>Ожидается</h2></div><div class="cloud ${supabaseConfigured ? 'ok' : 'warn'}">${supabaseConfigured ? '● Облако подключено' : '○ Облако не подключено'}</div></header>
    <section class="hero"><div><h1>Скриншоты «Случайные числа»</h1><p>Загружайте любое количество скриншотов до тиража. Ограничения по количеству нет.</p></div><label class="uploadBtn">+ Загрузить скриншоты<input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden></label></section>
    <section class="stats"><div class="card"><small>Загружено</small><strong id="count">0</strong><span>скриншотов</span></div><div class="card"><small>Распознано</small><strong id="recognized">0</strong><span>VERIFIED 10/10</span></div><div class="card"><small>Хранилище</small><strong>${supabaseConfigured ? 'Cloud' : 'Setup'}</strong><span>${supabaseConfigured ? 'Supabase' : 'нужно подключить'}</span></div></section>
    <section class="workspace"><div class="panel grow"><div class="panelHead"><h3>Скриншоты текущего тиража</h3><span id="processing"></span></div><div id="shots" class="shots empty">Пока нет загруженных скриншотов</div></div><div class="panel detail"><h3>Просмотр</h3><div id="detail" class="detailEmpty">Выберите скриншот</div></div></section>
    <section class="panel process"><h3>Движок обучения</h3><div class="steps"><div><b>1</b><span>Скриншоты до тиража</span></div><i>→</i><div><b>2</b><span>Распознавание 10 чисел</span></div><i>→</i><div><b>3</b><span>Фактический тираж</span></div><i>→</i><div><b>4</b><span>Зелёные совпадения</span></div><i>→</i><div><b>5</b><span>Обучение и «уход»</span></div></div><p class="note">После выхода тиража совпавшие числа записываются в сравнение автоматически. Отдельно сохраняется, какие выпавшие числа отсутствовали во всей предложке.</p></section>
  </main>
</div>`

const fileInput = document.querySelector('#fileInput')
fileInput.addEventListener('change', async (e) => {
  const files = [...e.target.files]
  fileInput.disabled = true
  document.querySelector('#processing').textContent = files.length ? `Обработка ${files.length}…` : ''

  for (const file of files) {
    const localUrl = URL.createObjectURL(file)
    const item = {
      id: crypto.randomUUID(),
      file,
      localUrl,
      upload: { mode: 'pending' },
      recognition: createPendingRecognition(file),
      createdAt: new Date().toISOString()
    }
    state.screenshots.push(item)
    renderShots()

    try {
      item.upload = await uploadScreenshot(file)
    } catch (err) {
      item.upload = {mode:'local',error:err.message||String(err)}
    }
    try {
      item.recognition = await recognizeScreenshot(file, item.upload.screenshot_id)
      if(item.upload.error) item.recognition.message += ` Файл остался в текущем окне: загрузка в облако не выполнена (${item.upload.error}).`
    } catch (err) {
      console.error(err)
      item.recognition = {
        status: 'error',
        confidence: null,
        numbers: [],
        message: `Ошибка обработки: ${err.message || err}`
      }
    }
    renderShots()
    if (!state.selectedId || state.selectedId === item.id) showDetail(item.id)
  }

  document.querySelector('#processing').textContent = ''
  e.target.value = ''
  fileInput.disabled = false
})

function renderShots() {
  document.querySelector('#count').textContent = state.screenshots.length
  document.querySelector('#recognized').textContent = state.screenshots.filter(s => s.recognition.status === 'verified').length
  const box = document.querySelector('#shots')
  if (!state.screenshots.length) {
    box.className='shots empty'
    box.textContent='Пока нет загруженных скриншотов'
    return
  }
  box.className='shots'
  box.innerHTML = state.screenshots.map((s,i)=>`<button class="shot" data-id="${s.id}"><img src="${s.localUrl}" alt=""><div><b>Скриншот №${i+1}</b><small>${new Date(s.createdAt).toLocaleTimeString('ru-RU')}</small><em>${statusText(s)}</em></div></button>`).join('')
  box.querySelectorAll('.shot').forEach(btn => btn.onclick=()=>showDetail(btn.dataset.id))
}

function statusText(s) {
  if (s.recognition.status === 'verified') return `✅ 10/10 · ${s.upload.mode === 'cloud' && s.recognition.saved !== false ? '☁ сохранён' : 'локально'}`
  if (s.recognition.status === 'review') return `⚠ проверить · найдено ${s.recognition.numbers.length}`
  if (s.recognition.status === 'error') return '❌ ошибка'
  return '⏳ обработка'
}

function showDetail(id) {
  const s = state.screenshots.find(x=>x.id===id)
  if(!s) return
  state.selectedId = id
  const nums = s.recognition.numbers?.length ? `<div class="recognizedNums">${s.recognition.numbers.map(n=>`<span>${n}</span>`).join('')}</div>` : ''
  document.querySelector('#detail').innerHTML = `<img class="preview" src="${s.localUrl}"><div class="status ${s.recognition.status}">${statusText(s)}</div>${nums}<p class="recognition-message"></p>`
  document.querySelector('.recognition-message').textContent = s.recognition.message
}
