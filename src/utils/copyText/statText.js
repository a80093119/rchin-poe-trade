// 詞綴文字層級的解析工具
// 進階物品敘述（Ctrl + Alt + C）會在詞綴前多一行 { 前綴 "喜鵲的"(階層：2)— 丟置 }，
// 並在數值後夾帶隨機值範圍，例如：增加 8(8-12)% 物品稀有度
// 這裡負責把這些額外資訊拆出來，讓詞綴內容回到 stats.json 可比對的樣子

const ADVANCED_MOD_HEADER = /^\{.*\}$/
const ADVANCED_MOD_HEADER_CONTENT = /^\{\s*(.*?)\s*\}$/
const AFFIX_TIER = /[（(]階層[：:]\s*(\d+)[）)]/
const AFFIX_NAME = /["“](.+?)["”]/
const AFFIX_TAGS = /[—–]\s*([^—–]+?)\s*$/
const ROLL_RANGE = /\((?:[+-]?\d+(?:\.\d+)?)(?:\s*[-–~至]\s*[+-]?\d+(?:\.\d+)?)?\)/g
const STAT_TAG = /\((augmented|implicit|enchant|crafted|fractured|scourge|unmet)\)\s*$/
// 全形括號整行包起來的說明文字，例如：（ 附加的天賦點不會被其它珠寶視為範圍內 ）
// stats.json 內沒有任何詞綴以（開頭，這類文字只會干擾比對
const DESCRIPTION_LINE = /^（.*）$/

// 詞綴種類需由限定詞（工藝前綴、破裂後綴…）優先比對，避免被「前綴 / 後綴」先攔截
export const AFFIX_TYPES = ['工藝', '破裂', '災魘', '附魔', '固定', '傳奇', '前綴', '後綴']

// 舊版複製文字以 (implicit) 等標記區分詞綴來源，進階敘述改放在詞綴標題內
const AFFIX_TYPE_TAGS = [
  { affixType: '工藝', tag: 'crafted' },
  { affixType: '破裂', tag: 'fractured' },
  { affixType: '災魘', tag: 'scourge' },
  { affixType: '附魔', tag: 'enchant' },
  { affixType: '固定', tag: 'implicit' }
]

export function isAdvancedModHeader(line) {
  return ADVANCED_MOD_HEADER.test((line || '').trim())
}

export function parseAdvancedModHeader(line) { // { 前綴 "喜鵲的"(階層：2)— 丟置 }
  const headerMatch = (line || '').trim().match(ADVANCED_MOD_HEADER_CONTENT)
  if (!headerMatch) {
    return null
  }

  const content = headerMatch[1]
  const typeText = content.split(/["“(（—–]/)[0] // 只取詞綴種類，避免詞綴名稱內的文字造成誤判
  const tierMatch = content.match(AFFIX_TIER)
  const nameMatch = content.match(AFFIX_NAME)
  const tagsMatch = content.match(AFFIX_TAGS)

  return {
    affixType: AFFIX_TYPES.find(type => typeText.includes(type)) || '',
    affixName: nameMatch ? nameMatch[1] : '',
    tier: tierMatch ? parseInt(tierMatch[1], 10) : null,
    tags: tagsMatch ? tagsMatch[1].split(/[,，]/).map(tag => tag.trim()).filter(tag => tag) : []
  }
}

export function stripRollRanges(text) { // 增加 8(8-12)% 物品稀有度 → 增加 8% 物品稀有度
  return (text || '').replace(ROLL_RANGE, '')
}

// 移除每一行結尾的 (implicit)、(enchant) 等標記；折行詞綴每行都會帶標記，不可只截斷到第一個
export function stripStatTags(text) {
  return (text || '')
    .split('\n')
    .map(subLine => subLine.replace(STAT_TAG, '').replace(/\s+$/, ''))
    .join('\n')
}

// 合成詞綴（hybrid mod）會把同一條 mod 的多行敘述以 \n 併在同一行，
// 但 stats.json 只收錄各自獨立的詞綴（例如「增加 #% 物理傷害」與「+# 命中值 (部分)」），
// 併著比對必定失敗，需先拆回單行。
// stats.json 本身就是多行的折行詞綴則要保持原樣：拆掉後得靠 wrapStats 重組，
// 而短句在相似度門檻下重組不回來，因此由 isFoldedStat 判斷後跳過。
export function splitHybridStatLines(lines, isFoldedStat = () => false) {
  return (lines || []).reduce((result, line) => {
    if (typeof line !== 'string' || line.indexOf('\n') === -1 || isFoldedStat(line)) {
      result.push(line)

      return result
    }

    const subLines = line.split('\n')
    // 進階敘述（Ctrl + Alt + C）只在整段結尾補一次 (crafted) 這類標記，
    // 拆行後需補回每一行，否則前面幾行會被當成隨機詞綴
    const tagMatch = subLines[subLines.length - 1].match(STAT_TAG)
    const tag = tagMatch ? tagMatch[0].trim() : ''

    subLines.forEach(subLine => {
      result.push(subLine && tag && !STAT_TAG.test(subLine) ? `${subLine} ${tag}` : subLine)
    })

    return result
  }, [])
}

export function isDescriptionLine(line) {
  return DESCRIPTION_LINE.test((line || '').replace(STAT_TAG, '').trim())
}

export function getAdvancedModHeaders(line) {
  return (line || '')
    .split('\n')
    .filter(subLine => isAdvancedModHeader(subLine))
    .map(subLine => parseAdvancedModHeader(subLine))
    .filter(header => header)
}

function appendAffixTypeTag(text, headers) { // 詞綴本身沒有標記時，改由詞綴標題補上
  if (!text || !headers.length || STAT_TAG.test(text)) {
    return text
  }

  const matched = AFFIX_TYPE_TAGS.find(item => headers.some(header => header.affixType === item.affixType))

  return matched ? `${text} (${matched.tag})` : text
}

// 遊戲會把同一組詞綴的多行敘述以 \n 併在同一行（區塊之間才是換行符號），
// 這裡移除詞綴標題與說明文字、拿掉隨機值範圍，只留下可與 stats.json 比對的詞綴內容
export function normalizeCopyLine(line) {
  const text = (line || '')
    .split('\n')
    .filter(subLine => !isAdvancedModHeader(subLine) && !isDescriptionLine(subLine))
    .map(subLine => stripRollRanges(subLine).replace(/\s+$/, ''))
    .join('\n')

  return appendAffixTypeTag(text, getAdvancedModHeaders(line))
}
