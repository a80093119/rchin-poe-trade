<!--
  傭兵契約書 tooltip OCR（季節性功能，獨立元件，可整包移除）

  背景：遊戲內複製傭兵契約書不含技能詞綴，只能靠 hover tooltip 截圖 + OCR 取得主技能，
  再對到 stats.json 的 mercenary.skill id 去 trade API 查詢。

  這是聯盟機制，約每 3 個月改版一次、下季可能消失，因此刻意與 Home.vue 解耦：
  Home 只需 <MercenaryContractOcr /> 一行。下季要移除時，只刪這兩個「季節性」檔案：
    - src/components/MercenaryContractOcr.vue（本檔）
    - src/utils/mercenaryOcr.js（傭兵技能比對邏輯）
  以下「通用」能力保留供未來重用：
    - src/utils/ocrCapture.js（截圖前處理 + tesseract，與機制無關）
    - background.js 的截圖骨架（desktopCapturer + capture_screen IPC）
-->
<template>
  <div class="merc-ocr-root">
  <!-- 浮動面板：Ctrl+C 契約書後自動浮現，不需展開任何面板 -->
  <div class="merc-ocr" :class="{ 'is-min': minimized }" v-if="busy || result || error">
    <div class="merc-ocr__header">
      <span class="merc-ocr__title" @click="minimized = !minimized" title="點擊可縮小/展開">傭兵契約書 OCR</span>
      <span class="merc-ocr__headbtns">
        <button class="merc-ocr__min" @click="minimized = !minimized" :title="minimized ? '展開' : '縮小到只剩標題'">{{ minimized ? '▢' : '—' }}</button>
        <button class="merc-ocr__close" @click="dismiss" title="關閉">×</button>
      </span>
    </div>

    <div class="merc-ocr__body" v-show="!minimized">
    <div v-if="busy" class="merc-ocr__status">辨識中… {{ progress }}</div>

    <div v-if="result" class="merc-ocr__result">
      <div class="merc-ocr__meta">
        耗時 {{ result.ms }}ms · 命中 {{ result.matches.length }} 個技能 · 勾選 {{ selectedIds.length }} 個
      </div>

      <div class="merc-ocr__region" :class="{ 'is-warn': !scanRegion }">
        <template v-if="scanRegion">掃描範圍：<b>已固定 ✓</b></template>
        <template v-else>⚠ 尚未固定掃描範圍（目前用游標自動判斷，較不穩）</template>
        <button class="merc-ocr__linkbtn" @click="openRegionEditor" :disabled="!lastCapture">
          {{ scanRegion ? '重新框選' : '框選範圍' }}
        </button>
        <button v-if="scanRegion" class="merc-ocr__linkbtn" @click="clearRegion">清除</button>
      </div>

      <div v-if="candidates.length" class="merc-ocr__skills">
        <div v-for="c in candidates" :key="c.id" class="merc-ocr__skill">
          <div class="merc-ocr__skillrow">
            <label class="merc-ocr__chip" :class="{ 'is-low': c.score !== null && c.score < 0.8, 'is-off': !c.on }"
              :title="c.id + (c.score !== null ? ' · score ' + c.score.toFixed(2) : ' · 手動加入')">
              <input type="checkbox" v-model="c.on" />
              {{ c.text }}<span v-if="c.score !== null && c.score < 0.8" class="merc-ocr__q">?</span>
            </label>
            <button class="merc-ocr__linkbtn" @click="c.adding = !c.adding">＋輔助</button>
          </div>
          <div v-if="c.supports.length || c.adding" class="merc-ocr__supports">
            <label v-for="sup in c.supports" :key="sup.id" class="merc-ocr__chip is-support"
              :class="{ 'is-off': !sup.on }" :title="sup.id">
              <input type="checkbox" v-model="sup.on" />
              <span class="merc-ocr__tag">輔</span>{{ sup.text }}
              <span class="merc-ocr__x" @click.prevent="removeSupport(c, sup)">✕</span>
            </label>
            <input v-if="c.adding" class="merc-ocr__add merc-ocr__add--sm" list="merc-support-list"
              v-model="c.supportPick" placeholder="加輔助…" @change="addSupport(c)" @keyup.enter="addSupport(c)" />
          </div>
        </div>
      </div>
      <div v-else class="merc-ocr__empty">沒有比對到技能，可用下方手動加入</div>

      <label class="merc-ocr__level">
        <input type="checkbox" v-model="useLevel" />
        傭兵等級 ≥
        <input class="merc-ocr__levelinput" type="number" min="1" max="99"
          v-model.number="levelMin" :disabled="!useLevel" />
      </label>

      <div class="merc-ocr__actions">
        <input class="merc-ocr__add" list="merc-skill-list" v-model="manualPick"
          placeholder="手動加入技能…" @change="addManualSkill" @keyup.enter="addManualSkill" />
        <button class="merc-ocr__search" :disabled="!selectedIds.length" @click="doSearch">
          搜尋 ({{ selectedIds.length }})
        </button>
      </div>

      <datalist id="merc-skill-list">
        <option v-for="s in skillOptions" :key="s.id" :value="s.text"></option>
      </datalist>
      <datalist id="merc-support-list">
        <option v-for="s in supportOptions" :key="s.id" :value="s.text"></option>
      </datalist>

      <details class="merc-ocr__debug">
        <summary>原始 OCR 文字</summary>
        <pre>{{ result.ocrText }}</pre>
      </details>
      <details class="merc-ocr__debug" v-if="result.previewDataURL">
        <summary>前處理後圖片</summary>
        <img :src="result.previewDataURL" class="merc-ocr__preview" />
      </details>
    </div>

    <div v-if="error" class="merc-ocr__error">錯誤：{{ error }}</div>
    </div>
  </div>

  <!-- 框選掃描範圍：在最近一次整張螢幕截圖上拖曳出技能所在矩形 -->
  <div v-if="editingRegion" class="merc-region-editor">
    <div class="merc-region-toolbar">
      <span>在下圖 tooltip 的技能區域上拖曳框選（框大一點也沒關係，會靠比對濾雜訊）</span>
      <button class="merc-ocr__search" @click="saveRegion" :disabled="!dragRect || dragRect.w < 5">儲存範圍</button>
      <button class="merc-ocr__close" @click="editingRegion = false">取消</button>
    </div>
    <div class="merc-region-canvas">
      <img ref="regionImg" :src="lastCapture && lastCapture.dataURL" class="merc-region-img" draggable="false"
        @mousedown.prevent="startDrag" @mousemove="onDrag" @mouseup="endDrag" @mouseleave="endDrag" />
      <div v-if="dragRect" class="merc-region-box"
        :style="{ left: dragRect.x + 'px', top: dragRect.y + 'px', width: dragRect.w + 'px', height: dragRect.h + 'px' }"></div>
    </div>
  </div>
  </div>
</template>

<script>
const { ipcRenderer } = require('electron')
import statsData from '../assets/poe/stats.json'
import { buildSkillIndex, buildSupportIndex, parseSkillsFromOcr, findEntryByText } from '../utils/mercenaryOcr'

export default {
  name: 'MercenaryContractOcr',
  props: {
    // 由 Home 從剪貼簿解析出的傭兵等級（Ctrl+C 契約書時帶入）
    detectedLevel: { type: Number, default: null }
  },
  data() {
    return {
      busy: false,
      minimized: false, // 面板縮小：只顯示標題列，不遮擋主 UI
      progress: '',
      result: null,
      error: '',
      candidates: [], // [{ id, text, score|null, on, kind:'skill'|'support' }]，score 為 null 代表手動加入
      manualPick: '',
      useLevel: true, // 是否把傭兵等級加入過濾
      levelMin: null, // 傭兵等級下限（misc_filters.ilvl.min）
      scanRegion: null, // 使用者框選的固定掃描範圍（螢幕比例 {x,y,w,h}）；null=自動游標裁切
      lastCapture: null, // 最近一次截圖（含整張螢幕 dataURL），供框選範圍用
      editingRegion: false, // 是否正在框選範圍
      dragStart: null, // 拖曳起點（相對圖片像素）
      dragRect: null // 目前框選矩形（相對圖片像素 {x,y,w,h}）
    }
  },
  computed: {
    skillOptions() {
      return [...this.skillIndex].sort((a, b) => a.text.localeCompare(b.text))
    },
    supportOptions() {
      return [...this.supportIndex].sort((a, b) => a.text.localeCompare(b.text))
    },
    // 勾選的技能 + 其底下勾選的輔助的總數（未勾選的技能，其輔助不計）——供按鈕與計數用
    selectedIds() {
      const ids = []
      this.candidates.forEach(skill => {
        if (!skill.on) return
        ids.push(skill.id)
        ;(skill.supports || []).forEach(sup => { if (sup.on) ids.push(sup.id) })
      })
      return ids
    }
  },
  created() {
    // 非響應式：索引建一次即可
    this.skillIndex = buildSkillIndex(statsData)
    this.supportIndex = buildSupportIndex(statsData)
    // 文字 → 項目 的查找表（手動加入時用）
    this.skillByText = new Map(this.skillIndex.map(s => [s.text, s]))
    this.supportByText = new Map(this.supportIndex.map(s => [s.text, s]))
    // 載入使用者先前框選的掃描範圍
    try {
      const saved = localStorage.getItem('mercScanRegion')
      if (saved) this.scanRegion = JSON.parse(saved)
    } catch (e) { /* ignore */ }
  },
  mounted() {
    // 先清掉任何殘留監聽（開發時 HMR 會讓舊實例的監聽器殘留在全域 ipcRenderer，
    // 導致 OCR 跑在隱形的舊實例上、畫面拿不到結果）→ 確保只有當前實例在收
    ipcRenderer.removeAllListeners('capture_done')
    ipcRenderer.removeAllListeners('capture_error')
    ipcRenderer.on('capture_done', this.handleCaptureDone)
    ipcRenderer.on('capture_error', this.handleCaptureError)
  },
  beforeDestroy() {
    ipcRenderer.removeListener('capture_done', this.handleCaptureDone)
    ipcRenderer.removeListener('capture_error', this.handleCaptureError)
  },
  methods: {
    async handleCaptureDone(_event, capture) {
      this.error = ''
      this.lastCapture = capture // 保留整張螢幕截圖供框選範圍用
      this.busy = true
      this.minimized = false // 新一次辨識自動展開，確保使用者看得到結果
      this.progress = ''
      try {
        // 動態載入：tesseract.js 只在真正用到時才進 bundle / 記憶體
        const { recognizeCapture } = await import('../utils/ocrCapture')
        const onProgress = p => { this.progress = p }

        // 有使用者自訂範圍就用固定 region；否則退回「依游標左上裁切」的自動模式。
        // （游標自動模式：tooltip 出現在游標左上方，crop 為螢幕高度比例 → 解析度無關）
        const ocr = this.scanRegion
          ? await recognizeCapture(capture, { onProgress, upscale: 2, region: this.scanRegion })
          : await recognizeCapture(capture, { onProgress, upscale: 2, crop: { left: 0.36, right: 0.08, up: 0.49, down: 0.10 } })
        const matches = parseSkillsFromOcr(ocr.ocrText, this.skillIndex)

        this.result = { ...ocr, matches, usedFull: false }
        // 命中技能 → 可勾選候選（預設全勾）；每個技能底下帶一串它自己的輔助（手動加）
        this.candidates = matches.map(m => ({
          id: m.id, text: m.text, score: m.score, on: true,
          supports: [], adding: false, supportPick: ''
        }))
        // 帶入剪貼簿解析到的傭兵等級（Ctrl+C 才有）
        this.levelMin = this.detectedLevel
        this.useLevel = this.detectedLevel != null
        // 轉發到 main process 終端機（開發觀測用）
        ipcRenderer.send('renderer_log', '[mercOcr]', {
          ms: ocr.ms,
          matches: matches.map(m => `${m.text}(${m.id}) ${m.score.toFixed(2)}`),
          ocrText: ocr.ocrText
        })
      } catch (e) {
        this.error = (e && e.message) || String(e)
        ipcRenderer.send('renderer_log', '[mercOcr] ERROR', (e && e.message) || String(e))
        console.error('[mercOcr] failed:', e)
      } finally {
        this.busy = false
      }
    },
    handleCaptureError(_event, msg) {
      this.error = msg
    },
    addManualSkill() {
      const text = (this.manualPick || '').trim()
      this.manualPick = ''
      if (!text) return
      // 先精準（datalist 選中的完整文字），再退回「忽略階級/分隔符」的寬容比對
      const entry = this.skillByText.get(text) || findEntryByText(text, this.skillIndex)
      if (!entry) { this.error = `找不到技能「${text}」`; return }
      if (this.candidates.some(c => c.id === entry.id)) return // 已存在
      this.candidates.push({
        id: entry.id, text: entry.text, score: null, on: true,
        supports: [], adding: false, supportPick: ''
      })
    },
    addSupport(skill) {
      const text = (skill.supportPick || '').trim()
      skill.supportPick = ''
      if (!text) return
      const entry = this.supportByText.get(text) || findEntryByText(text, this.supportIndex)
      if (!entry) { this.error = `找不到輔助「${text}」`; return }
      if (skill.supports.some(s => s.id === entry.id)) return // 該技能已有此輔助
      skill.supports.push({ id: entry.id, text: entry.text, on: true })
    },
    removeSupport(skill, sup) {
      skill.supports = skill.supports.filter(s => s.id !== sup.id)
    },
    doSearch() {
      // 每個勾選的技能 → 一個 { skillId, supportIds } 群組（各自綁自己的輔助）
      const groups = this.candidates
        .filter(skill => skill.on)
        .map(skill => ({
          skillId: skill.id,
          supportIds: (skill.supports || []).filter(sup => sup.on).map(sup => sup.id)
        }))
      if (!groups.length) return
      this.$emit('search', {
        groups,
        levelMin: this.useLevel && this.levelMin != null ? Number(this.levelMin) : null
      })
    },
    dismiss() {
      this.result = null
      this.candidates = []
      this.error = ''
      this.busy = false
      this.minimized = false
    },
    // ---- 框選掃描範圍 ----
    openRegionEditor() {
      if (!this.lastCapture) return
      this.dragRect = null
      this.dragStart = null
      this.editingRegion = true
    },
    imgPoint(e) {
      const img = this.$refs.regionImg
      const r = img.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
        y: Math.max(0, Math.min(e.clientY - r.top, r.height)),
        w: r.width,
        h: r.height
      }
    },
    startDrag(e) {
      const p = this.imgPoint(e)
      this.dragStart = p
      this.dragRect = { x: p.x, y: p.y, w: 0, h: 0 }
    },
    onDrag(e) {
      if (!this.dragStart) return
      const p = this.imgPoint(e)
      this.dragRect = {
        x: Math.min(p.x, this.dragStart.x),
        y: Math.min(p.y, this.dragStart.y),
        w: Math.abs(p.x - this.dragStart.x),
        h: Math.abs(p.y - this.dragStart.y)
      }
    },
    endDrag() {
      this.dragStart = null
    },
    saveRegion() {
      if (!this.dragRect || this.dragRect.w < 5 || this.dragRect.h < 5) return
      const img = this.$refs.regionImg
      const r = img.getBoundingClientRect()
      // 轉成整張螢幕的比例（解析度無關）
      const region = {
        x: this.dragRect.x / r.width,
        y: this.dragRect.y / r.height,
        w: this.dragRect.w / r.width,
        h: this.dragRect.h / r.height
      }
      this.scanRegion = region
      localStorage.setItem('mercScanRegion', JSON.stringify(region))
      this.editingRegion = false
    },
    clearRegion() {
      this.scanRegion = null
      localStorage.removeItem('mercScanRegion')
    }
  }
}
</script>

<style scoped>
.merc-ocr {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 3000;
  width: 340px;
  max-height: 80vh;
  overflow-y: auto;
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid #6b5a2e;
  border-radius: 6px;
  background: rgba(20, 18, 12, 0.96);
  color: #d8c7a0;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
.merc-ocr__header {
  display: flex; justify-content: space-between; align-items: center;
  font-weight: bold; color: #e8d9a8; margin-bottom: 4px;
  border-bottom: 1px solid #4a3f22; padding-bottom: 4px;
}
/* 縮小狀態：面板收成只剩標題列，寬度自適應、不再限制高度，貼在右下角不擋主 UI */
.merc-ocr.is-min { width: auto; max-height: none; overflow: visible; }
.merc-ocr.is-min .merc-ocr__header { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
.merc-ocr__title { cursor: pointer; }
.merc-ocr__headbtns { display: inline-flex; align-items: center; gap: 2px; margin-left: 10px; }
.merc-ocr__min {
  background: none; border: none; color: #c8b273; font-size: 15px;
  line-height: 1; cursor: pointer; padding: 0 4px;
}
.merc-ocr__min:hover { color: #fff; }
.merc-ocr__close {
  background: none; border: none; color: #c8b273; font-size: 18px;
  line-height: 1; cursor: pointer; padding: 0 4px;
}
.merc-ocr__close:hover { color: #fff; }
.merc-ocr__status { margin-top: 6px; color: #c7b273; }
.merc-ocr__meta { margin-top: 6px; opacity: 0.7; font-size: 12px; }
.merc-ocr__region { margin-top: 6px; font-size: 12px; }
.merc-ocr__region.is-warn { color: #e0b060; }
.merc-ocr__linkbtn {
  background: none; border: 1px solid #6b5a2e; border-radius: 4px; color: #d8c7a0;
  cursor: pointer; padding: 1px 8px; margin-left: 6px; font-size: 12px;
}
.merc-ocr__linkbtn:hover { background: #3a3320; }
.merc-ocr__linkbtn:disabled { opacity: 0.4; cursor: not-allowed; }
.merc-region-editor {
  position: fixed; inset: 0; z-index: 4000; background: rgba(0, 0, 0, 0.88);
  display: flex; flex-direction: column;
}
.merc-region-toolbar {
  padding: 8px 12px; display: flex; gap: 12px; align-items: center;
  color: #d8c7a0; background: #14120c; font-size: 13px; flex-wrap: wrap;
}
.merc-region-canvas { position: relative; flex: 1; overflow: hidden; }
.merc-region-img {
  display: block; max-width: 100%; max-height: 100%;
  user-select: none; cursor: crosshair;
}
.merc-region-box {
  position: absolute; border: 2px solid #6cc06c;
  background: rgba(108, 192, 108, 0.2); pointer-events: none;
}
.merc-ocr__chips { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
.merc-ocr__skills { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.merc-ocr__skill { border-left: 2px solid #4a3f22; padding-left: 6px; }
.merc-ocr__skillrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.merc-ocr__supports {
  display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 2px 14px;
}
.merc-ocr__x { cursor: pointer; margin-left: 4px; color: #c98b6b; }
.merc-ocr__x:hover { color: #fff; }
.merc-ocr__add--sm { flex: 0 0 130px; min-width: 110px; padding: 1px 6px; font-size: 12px; }
.merc-ocr__chip {
  padding: 2px 8px; border-radius: 12px;
  background: #2f5e2f; color: #d7f0d7; border: 1px solid #4a8a4a;
}
.merc-ocr__chip { cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 4px; }
.merc-ocr__chip input { margin: 0; cursor: pointer; }
.merc-ocr__chip.is-low { background: #5e4a2f; color: #f0e0c0; border-color: #8a6a3a; }
.merc-ocr__chip.is-off { opacity: 0.45; }
.merc-ocr__chip.is-support { background: #2f3f5e; border-color: #4a5f8a; color: #cfe0f5; }
.merc-ocr__tag {
  font-size: 10px; background: #4a5f8a; color: #fff; border-radius: 3px;
  padding: 0 3px; line-height: 1.4;
}
.merc-ocr__q { color: #f0c060; font-weight: bold; }
.merc-ocr__level { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.merc-ocr__level input[type="checkbox"] { margin: 0; }
.merc-ocr__levelinput {
  width: 60px; padding: 2px 6px; border-radius: 4px;
  background: #14120c; color: #d8c7a0; border: 1px solid #6b5a2e;
}
.merc-ocr__levelinput:disabled { opacity: 0.4; }
.merc-ocr__actions { margin-top: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.merc-ocr__add {
  flex: 1 1 180px; min-width: 140px; padding: 3px 8px; border-radius: 4px;
  background: #14120c; color: #d8c7a0; border: 1px solid #6b5a2e;
}
.merc-ocr__search {
  padding: 4px 14px; border-radius: 4px; cursor: pointer;
  background: #2f5e2f; color: #d7f0d7; border: 1px solid #4a8a4a;
}
.merc-ocr__search:disabled { opacity: 0.4; cursor: not-allowed; }
.merc-ocr__empty { margin-top: 6px; color: #c98b6b; }
.merc-ocr__error { margin-top: 6px; color: #e08a8a; }
.merc-ocr__debug { margin-top: 6px; }
.merc-ocr__debug summary { cursor: pointer; opacity: 0.8; }
.merc-ocr__debug pre {
  white-space: pre-wrap; max-height: 160px; overflow: auto;
  background: rgba(0,0,0,0.35); padding: 6px; border-radius: 4px; font-size: 12px;
}
.merc-ocr__preview { max-width: 100%; border: 1px solid #6b5a2e; border-radius: 4px; }
</style>
