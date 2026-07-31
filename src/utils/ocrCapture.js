// 通用螢幕截圖 OCR（與任何特定遊戲機制無關，可重用）
//
// 輸入 background.js 透過 desktopCapturer 產生的 capture payload，
// 做前處理（依游標裁切 / 放大 / 灰階）後丟 tesseract.js，輸出「純 OCR 文字」。
// 不含任何比對邏輯；要辨識什麼由呼叫端自行處理（例如傭兵技能比對）。
//
// 只在 Electron renderer（有 document / canvas / Image）執行。

import { createWorker } from 'tesseract.js'

const TESS_VER = '7.0.0'
// 明確指定 CDN 路徑，避開 webpack 打包 worker/wasm 的雷；app 本來就要連網
function tessOpts(onProgress) {
  return {
    workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VER}/dist/worker.min.js`,
    corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESS_VER}`,
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_best', // best 模型，CJK 準度較高
    logger: m => {
      console.log('[tesseract]', m.status, `${(m.progress * 100) | 0}%`)
      if (typeof onProgress === 'function') onProgress(`${m.status} ${(m.progress * 100) | 0}%`)
    }
  }
}

const workers = new Map() // lang -> Promise<Worker>

async function getWorker(lang, onProgress) {
  if (!workers.has(lang)) {
    workers.set(lang, (async () => {
      const worker = await createWorker(lang, 1, tessOpts(onProgress))
      // PSM 6：把整張圖當「單一文字區塊」讀，不做版面/欄位分析。
      // tooltip 是置中多行技能名，預設 PSM 3 會被左側物品欄圖示干擾而斷行崩壞。
      await worker.setParameters({ tessedit_pageseg_mode: '6' })
      return worker
    })())
  }
  return workers.get(lang)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

// 依游標位置裁出附近一塊（DIP 邊界，預設偏「tooltip 往右下延伸」），再放大 + 灰階。
// 無游標資訊或 full=true 時用全圖。
function preprocess(img, capture, opts = {}) {
  const { upscale = 2, full = false, crop = {}, region = null } = opts
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height

  const { cursor, scale, displayBounds } = capture || {}
  if (!full && region) {
    // 使用者預先框選的固定範圍（以整張螢幕的比例表示 → 解析度無關）
    sx = clamp(region.x * img.width, 0, img.width)
    sy = clamp(region.y * img.height, 0, img.height)
    sw = clamp(region.w * img.width, 0, img.width - sx)
    sh = clamp(region.h * img.height, 0, img.height - sy)
  } else if (!full && cursor && scale && displayBounds) {
    const cx = (cursor.x - displayBounds.x) * scale
    const cy = (cursor.y - displayBounds.y) * scale
    // crop.* 為「螢幕高度的比例」而非固定像素 → 解析度無關（PoE UI/tooltip 佔螢幕比例固定）。
    // img.height 即實體螢幕高度。tooltip 出現在游標左上方，故 up/left 給得比 down/right 大。
    const H = img.height
    const left = (crop.left != null ? crop.left : 0.36) * H
    const right = (crop.right != null ? crop.right : 0.08) * H
    const up = (crop.up != null ? crop.up : 0.49) * H
    const down = (crop.down != null ? crop.down : 0.10) * H
    sx = clamp(cx - left, 0, img.width)
    sy = clamp(cy - up, 0, img.height)
    sw = clamp(cx + right, 0, img.width) - sx
    sh = clamp(cy + down, 0, img.height) - sy
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw * upscale)
  canvas.height = Math.round(sh * upscale)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]
    d[i] = d[i + 1] = d[i + 2] = g
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas
}

// 對 capture 做 OCR，回傳純文字。
// capture = { dataURL, cursor, scale, displayBounds, size }
// opts = { lang='chi_tra', upscale, full, crop, onProgress }
export async function recognizeCapture(capture, opts = {}) {
  const t0 = performance.now()
  const { lang = 'chi_tra', onProgress } = opts
  const img = await loadImage(capture.dataURL)
  const worker = await getWorker(lang, onProgress)
  const canvas = preprocess(img, capture, opts)
  const { data } = await worker.recognize(canvas)
  return {
    ocrText: data.text,
    words: data.words || [],
    previewDataURL: canvas.toDataURL('image/png'),
    ms: Math.round(performance.now() - t0)
  }
}

export async function disposeOcr() {
  for (const [lang, p] of workers) {
    try {
      const w = await p
      await w.terminate()
    } catch (e) { /* ignore */ }
    workers.delete(lang)
  }
}
