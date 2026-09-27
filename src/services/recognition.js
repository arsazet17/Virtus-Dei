import { createWorker, PSM } from 'tesseract.js'
import { invokeFunction } from './functions.js'
import { supabase } from '../supabase.js'
import { findSelectedCells, validateRecognizedNumbers } from './selected-cells.js'
export { validateRecognizedNumbers } from './selected-cells.js'

let workerPromise
async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { logger: () => {} }).then(async worker => {
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_LINE, user_defined_dpi: '300' })
      return worker
    }).catch(error => { workerPromise = null; throw error })
  }
  return workerPromise
}
export function createPendingRecognition(file) {
  return { status:'pending', confidence:null, numbers:[], message:`Файл ${file.name} принят. Идёт распознавание выбранных ячеек.` }
}
export async function recognizeScreenshot(file, screenshotId) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d', {willReadFrequently:true})
  context.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close()
  const detection = findSelectedCells(context.getImageData(0,0,canvas.width,canvas.height))
  if (detection.reason) return {status:'review',confidence:0,numbers:[],message:detection.reason,coordinates:{}}
  const worker = await getWorker()
  const values=[], confidence=[], coordinates={}
  for (const cell of detection.cells) {
    // White digits on blue become black digits on white. The cell border is excluded.
    const inset = Math.max(2, Math.round(cell.width * 0.12))
    const w=cell.width-inset*2, h=cell.height-inset*2
    const crop = context.getImageData(cell.left+inset,cell.top+inset,w,h)
    for(let p=0;p<crop.data.length;p+=4) {
      const ink=crop.data[p]>165 && crop.data[p+1]>165 && crop.data[p+2]>165
      crop.data[p]=crop.data[p+1]=crop.data[p+2]=ink?0:255; crop.data[p+3]=255
    }
    const raw=document.createElement('canvas'); raw.width=w;raw.height=h;raw.getContext('2d').putImageData(crop,0,0)
    const tile=document.createElement('canvas');tile.width=w*4+40;tile.height=h*4+40
    const ctx=tile.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,tile.width,tile.height);ctx.drawImage(raw,20,20,w*4,h*4)
    let {data}=await worker.recognize(tile)
    if (!/^\d{1,2}$/.test(String(data.text||'').trim()) || Number(data.confidence)<70) {
      const retryCrop=context.getImageData(cell.left+inset,cell.top+inset,w,h)
      for(let p=0;p<retryCrop.data.length;p+=4) {
        const ink=retryCrop.data[p]>220&&retryCrop.data[p+1]>220&&retryCrop.data[p+2]>220
        retryCrop.data[p]=retryCrop.data[p+1]=retryCrop.data[p+2]=ink?0:255;retryCrop.data[p+3]=255
      }
      raw.getContext('2d').putImageData(retryCrop,0,0)
      ctx.fillStyle='#fff';ctx.fillRect(0,0,tile.width,tile.height);ctx.drawImage(raw,20,20,w*4,h*4)
      await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK})
      try {
        const retry=await worker.recognize(tile)
        if(Number(retry.data.confidence)>Number(data.confidence)) data=retry.data
      } finally {await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE})}
    }
    const text=String(data.text||'').trim()
    const n=/^\d{1,2}$/.test(text)?Number(text):NaN
    values.push(n);confidence.push(Number(data.confidence)||0)
    if (Number.isInteger(n)) coordinates[n]={x:Math.round(cell.left/scale),y:Math.round(cell.top/scale),width:Math.round(cell.width/scale),height:Math.round(cell.height/scale)}
  }
  const checked=validateRecognizedNumbers(values)
  const certain=confidence.every(c=>c>=70)
  const result={status:checked.ok&&certain?'verified':'review',numbers:checked.numbers,confidence:Math.min(...confidence),coordinates,
    message:checked.ok&&certain?`Распознано 10/10 выбранных чисел: ${checked.numbers.join(', ')}`:`Нужно проверить выбранные ячейки: уверенно распознано ${values.filter((n,i)=>Number.isInteger(n)&&confidence[i]>=70).length} из 10. Повторите скриншот крупнее.`}
  if (screenshotId && supabase) {
    try {
      const saved=await invokeFunction('screenshot-ocr',{screenshot_id:screenshotId,numbers:result.numbers,confidence:result.confidence,coordinates,client_status:result.status})
      if (!saved?.ok) throw new Error(saved?.error||'Не удалось сохранить результат')
      result.saved=true
    } catch(error) { result.saved=false; result.message+=` Результат пока не сохранён в облаке: ${error.message}` }
  }
  return result
}
