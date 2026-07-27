// 遊戲內複製文字（Ctrl + C / Ctrl + Alt + C）的結構化解析
// 產出的 lines 會以「稀有度」為第一筆，維持既有詞綴分析流程的索引慣例

import { normalizeCopyLine } from './statText'

export const COPY_SECTION_SEPARATOR = '--------'

const ITEM_CLASS_LABEL = '物品種類'
const RARITY_LABEL = '稀有度'
const UNUSABLE_TEXT = '你無法使用這項裝備'
const UNIDENTIFIED_TEXT = '未鑑定'
const SET_STRING = /<(.+)>/g // <<set:MS>><<set:M>><<set:S>>

function isLabelLine(line, label) {
  return new RegExp(`^${label}\\s*[:：]`).test((line || '').trim())
}

function getLabelValue(line, label) {
  return (line || '').trim().replace(new RegExp(`^${label}\\s*[:：]`), '').trim()
}

function cleanNameLine(line) {
  return typeof line === 'string' ? line.replace(SET_STRING, '').trim() : line
}

export function splitCopyLines(copyText, newLine) {
  return (copyText || '').split(newLine || '\n')
}

export function normalizeCopyLines(lines) {
  return (lines || []).map(line => normalizeCopyLine(line))
}

export function findLabelValue(lines, label) { // 取得「物品等級: 76」這類屬性行的值
  const matchedLine = (lines || []).find(line => isLabelLine(line, label))

  return matchedLine ? getLabelValue(matchedLine, label) : ''
}

export function findLabelNumber(lines, label) {
  const value = parseInt(findLabelValue(lines, label), 10)

  return Number.isNaN(value) ? null : value
}

export function parseItemCopyText(copyText, { newLine = '\n' } = {}) {
  const normalizedLines = normalizeCopyLines(splitCopyLines(copyText, newLine))
  const rarityIndex = normalizedLines.findIndex(line => isLabelLine(line, RARITY_LABEL))
  // 分析用行陣列：物品種類（3.14 起新增）不參與詞綴判斷，由稀有度開始擷取
  const lines = rarityIndex > -1 ? normalizedLines.slice(rarityIndex) : [...normalizedLines]
  // 無法使用的裝備會多一段提示文字，移除後名稱與基底才會回到固定位置
  const unusableIndex = lines.findIndex(line => line.indexOf(UNUSABLE_TEXT) > -1)
  if (unusableIndex > -1) {
    lines.splice(unusableIndex, lines[unusableIndex + 1] === COPY_SECTION_SEPARATOR ? 2 : 1)
  }

  if (lines.length > 1) {
    lines[1] = cleanNameLine(lines[1]) // 名稱
  }
  if (lines.length > 2) {
    lines[2] = cleanNameLine(lines[2]) // 基底
  }

  const name = !lines[1] || lines[1] === COPY_SECTION_SEPARATOR ? '' : lines[1]
  const baseType = !lines[2] || lines[2] === COPY_SECTION_SEPARATOR ? '' : lines[2]

  return {
    lines, // 供既有詞綴分析流程使用：第一筆為稀有度、第二筆為名稱、第三筆為基底
    text: normalizedLines.join(newLine),
    itemClass: findLabelValue(normalizedLines, ITEM_CLASS_LABEL),
    rarity: rarityIndex > -1 ? getLabelValue(normalizedLines[rarityIndex], RARITY_LABEL) : '',
    name,
    baseType,
    displayName: baseType ? `${name} ${baseType}` : name,
    isUnidentified: lines.some(line => line.indexOf(UNIDENTIFIED_TEXT) > -1)
  }
}
