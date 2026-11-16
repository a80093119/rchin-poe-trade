// 傭兵契約書 tooltip OCR → mercenary.skill id 比對
//
// 遊戲內複製（Ctrl+C）不含技能詞綴，只能靠 hover tooltip 截圖 + OCR 取得主技能名。
// OCR 結果一定有雜訊（金幣數字、堆疊數、標點/全半形差異、偶發錯字），
// 但技能是「封閉集合」（stats.json 裡 type === 'mercenary' 且 id 為 skill_ 開頭，共 ~268 條），
// 所以用「正規化 + 相似度最佳比對」就能把髒字串救回成正確的 skill id。

// 技能名全為中日韓漢字，正規化時「只保留漢字」，一次清掉所有分隔符（·／．／‧ 等各種變體）、
// 空白、數字、拉丁字母、標點。如此可同時解決：
//   1. tooltip 與 API 的分隔符不一致（· vs ．(U+FF0E) vs ‧(U+2027)）
//   2. OCR 把金幣數字（如「9,232」）或其他 UI 字元併進技能行造成的污染
export function normalizeSkillText(text) {
  return (text || '').replace(/[^㐀-䶿一-鿿]/g, '')
}

// 字元層級 Levenshtein 距離
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// bigram Dice 係數（對長字串穩），與 Levenshtein 相似度取最大值
// （短字串如「暴怒」只有 1 個 bigram，單字錯字會讓 Dice 歸零，故需 Levenshtein 補）
function similarity(a, b) {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  const bigrams = s => {
    const set = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.substr(i, 2)
      set.set(g, (set.get(g) || 0) + 1)
    }
    return set
  }
  const A = bigrams(a)
  const B = bigrams(b)
  let inter = 0
  A.forEach((cnt, g) => { if (B.has(g)) inter += Math.min(cnt, B.get(g)) })
  const total = (a.length - 1) + (b.length - 1)
  const dice = total > 0 ? (2 * inter) / total : 0
  return Math.max(lev, dice)
}

function buildMercenaryIndex(statsJson, idPrefix) {
  const result = (statsJson && statsJson.result) || statsJson || []
  const mercenary = result.find(r => r.id === 'mercenary')
  if (!mercenary) return []
  return mercenary.entries
    .filter(e => e.id.startsWith(idPrefix))
    .map(e => ({ id: e.id, text: e.text, norm: normalizeSkillText(e.text) }))
}

// 由 stats.json 建立技能索引：[{ id, text, norm }]（主技能，供 OCR 比對與手動加入）
export function buildSkillIndex(statsJson) {
  return buildMercenaryIndex(statsJson, 'mercenary.skill_')
}

// 由 stats.json 建立輔助寶石索引：[{ id, text, norm, nameNorm, tier }]
// 輔助詞綴文字格式為「名稱 (階級 N)」，另拆出 nameNorm（只留漢字的名稱）與 tier（階級數字），
// 供複製文字的「名稱(階層：N)」依「名稱 + 階級」精準對應（normalizeSkillText 會丟掉數字，無法只靠 norm 區分階級）。
export function buildSupportIndex(statsJson) {
  return buildMercenaryIndex(statsJson, 'mercenary.support_').map(entry => {
    const m = (entry.text || '').match(/^(.+?)\s*[（(]\s*階級\s*(\d+)\s*[）)]\s*$/)
    return {
      ...entry,
      nameNorm: m ? normalizeSkillText(m[1]) : entry.norm,
      tier: m ? m[2] : null
    }
  })
}

// 複製文字的輔助行（例：「多重打擊(階層：2)」）→ 對應的輔助索引項目（依名稱 + 階級比對）。
// 階層數字必不可少（用來區分低階/高階同名輔助的階級）；找不到回傳 null。
export function matchSupportLine(line, supportIndex) {
  const tierMatch = (line || '').match(/[（(]\s*階層\s*[：:]\s*(\d+)\s*[）)]\s*$/)
  if (!tierMatch) return null
  const tier = tierMatch[1]
  const name = normalizeSkillText(line.slice(0, tierMatch.index))
  if (name.length < 2) return null
  const exact = supportIndex.find(e => e.tier === tier && e.nameNorm === name)
  if (exact) return exact
  // 退回前綴比對（容忍名稱細微差異），但仍要求階級相同
  return supportIndex.find(e => e.tier === tier && (e.nameNorm.startsWith(name) || name.startsWith(e.nameNorm))) || null
}

// 解析傭兵契約書複製文字 → { groups: [{ skillId, skillText, supports: [{ id, text }] }], levelMin }
// （帶 text 供面板顯示/勾選；面板送查時再轉成 { skillId, supportIds }）
// 3.30 起複製文字已含技能/輔助詞綴，結構為：
//   ...（物品種類/稀有度/名稱、傭兵名）── 流派/傭兵等級 ── 各技能區塊（首行主技能＋其輔助）── 右鍵說明
// 技能區塊 = 「傭兵等級」區段之後、footer（查看傭兵細節/試煉之地）之前，以 -------- 分隔的每一段。
export function parseMercenaryContract(copyText, { skillIndex = [], supportIndex = [], newLine = '\n' } = {}) {
  void newLine // 一律容忍 \r\n / \n
  const sections = (copyText || '')
    .split(/-{3,}/)
    .map(block => block.split(/\r?\n/).map(l => l.trim()).filter(Boolean))

  let levelMin = null
  for (const sec of sections) {
    for (const l of sec) {
      const m = l.match(/傭兵等級\s*[：:]\s*(\d+)/)
      if (m) { levelMin = parseInt(m[1], 10); break }
    }
    if (levelMin != null) break
  }

  const startIdx = sections.findIndex(sec => sec.some(l => /傭兵等級/.test(l)))
  let endIdx = sections.findIndex(sec => sec.some(l => /查看傭兵細節|試煉之地/.test(l)))
  if (endIdx === -1) endIdx = sections.length

  const groups = []
  if (startIdx !== -1) {
    for (const sec of sections.slice(startIdx + 1, endIdx)) {
      if (!sec.length) continue
      const skill = findEntryByText(sec[0], skillIndex) || matchSkillLine(sec[0], skillIndex, 0.6)
      if (!skill) continue
      const supports = []
      const seen = new Set()
      for (const l of sec.slice(1)) {
        const sup = matchSupportLine(l, supportIndex)
        if (sup && !seen.has(sup.id)) { seen.add(sup.id); supports.push({ id: sup.id, text: sup.text }) }
      }
      groups.push({ skillId: skill.id, skillText: skill.text, supports })
    }
  }

  return { groups, levelMin }
}

// 手動輸入的文字 → 索引項目（供「手動加入技能／輔助」用）。
// 使用者常只打技能／輔助本名，懶得補上「(階級 1)」或分隔符，故：
//   1) 先試正規化後全等（最精準）
//   2) 再退回「名稱前綴」比對——normalizeSkillText 只留漢字、去掉階級數字，
//      故「多重投射物 (階級 1)」正規化為「多重投射物階級」，使用者打「多重投射物」即可命中。
// 找不到回傳 null（呼叫端據此給提示，不再默默無反應）。
export function findEntryByText(text, index) {
  const norm = normalizeSkillText(text)
  if (norm.length < 2) return null
  const exact = index.find(e => e.norm === norm)
  if (exact) return exact
  return index.find(e => e.norm.startsWith(norm) || norm.startsWith(e.norm)) || null
}

// 單行 → 最佳技能候選；分數低於門檻回傳 null。
// OCR 常在技能名前黏到物品欄/圖示的雜訊字（如「到當凋零之步」「和威嚇戰吼」），
// 故除了整行，也嘗試「去掉開頭 1~2 字」的變體，取最佳分。
export function matchSkillLine(line, index, threshold = 0.6) {
  const norm = normalizeSkillText(line)
  if (norm.length < 2) return null
  const variants = [norm]
  if (norm.length >= 3) variants.push(norm.slice(1))
  if (norm.length >= 4) variants.push(norm.slice(2))
  let best = null
  for (const v of variants) {
    for (const entry of index) {
      const score = similarity(v, entry.norm)
      if (!best || score > best.score) best = { ...entry, score, ocr: line }
      if (score === 1) break
    }
    if (best && best.score === 1) break
  }
  return best && best.score >= threshold ? best : null
}

// 從整段 OCR 文字擷取技能：逐行對封閉集合做最佳比對。
// 不用「傭兵等級…右鍵點擊」之類的錨點窗切割——OCR 常把字拆開空格導致錨點不中，
// 且物品欄格子的「等級:82」標籤會誤中 START 錨點而把技能全切掉。封閉集合比對本身
// 已足夠可靠（跨實測 0 誤判），故直接掃全部行、以技能 id 去重。
export function parseSkillsFromOcr(ocrText, index, { threshold = 0.6 } = {}) {
  const rawLines = (ocrText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  const matches = []
  const seen = new Set()
  for (const line of rawLines) {
    const m = matchSkillLine(line, index, threshold)
    if (m && !seen.has(m.id)) {
      seen.add(m.id)
      matches.push(m)
    }
  }
  return matches
}
