// 最後通牒（試煉大師）物品查詢：
// 把複製文字的挑戰／獎勵／需求獻祭／區域等級轉為官方 API 的 ultimatum_filters 與 map_filters.area_level，
// 試煉詞綴則對應 ultimatum.umod_# 詞綴 ID

import { COPY_SECTION_SEPARATOR, findLabelNumber, findLabelValue } from './copyText'

const stringSimilarity = require('string-similarity')

// 「可以使用於個人地圖裝置以開啟前往試煉大師地盤的傳送門」：最後通牒雕刻與刻劃最後通牒共用
export const ULTIMATUM_DESCRIPTION = '前往試煉大師地盤的傳送門'

// 這些 ID 不是詞綴 ID，改由 applyUltimatumSearchStat 寫入 query.filters
export const ULTIMATUM_STAT_IDS = {
  challenge: 'ultimatum_filters.ultimatum_challenge',
  reward: 'ultimatum_filters.ultimatum_reward',
  input: 'ultimatum_filters.ultimatum_input',
  output: 'ultimatum_filters.ultimatum_output',
  areaLevel: 'map_filters.area_level'
}

export const ULTIMATUM_SEARCH_STAT_IDS = Object.values(ULTIMATUM_STAT_IDS)

const CHALLENGE_LABEL = '挑戰'
const AREA_LEVEL_LABEL = '區域等級'
const INPUT_LABEL = '需求獻祭'
const REWARD_LABEL = '獎勵'
const MOD_DESCRIPTION = /[（(][^（(]*?[）)]/g // 詞綴後的說明文字，可能跨行
const INPUT_COUNT = /\s*x\s*(\d+)\s*$/ // 需求獻祭: 暴君 x5
const MONSTER_LIFE_TEXT = '怪物生命' // #% 更多怪物生命
const STAT_NUMBER = /\d+(?:\.\d+)?/
const SIMILARITY_THRESHOLD = 0.9

// 遊戲內敘述與 API 選項文字不同（例：站在符文上 / 站在石陣內），因此以關鍵字對應
const CHALLENGE_OPTIONS = [
  { option: 'Conquer', keywords: ['符文', '石陣'] },
  { option: 'Defense', keywords: ['神壇', '祭壇', '保護'] },
  { option: 'Survival', keywords: ['存活', '倖存'] },
  { option: 'Exterminate', keywords: ['擊敗', '消滅', '殲滅'] }
]

function splitCopySections(itemArray) {
  return (itemArray || []).reduce((sections, line) => {
    if (line === COPY_SECTION_SEPARATOR) {
      sections.push([])
    } else {
      sections[sections.length - 1].push(line)
    }

    return sections
  }, [[]])
}

function stripModDescriptions(lines) { // 說明文字可能跨行，需整段移除後再重新切行
  return lines
    .join('\n')
    .replace(MOD_DESCRIPTION, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line)
}

function getGroupEntries(allStats, groupId) {
  return (allStats?.result || [])
    .filter(group => group.id === groupId)
    .flatMap(group => group.entries || [])
}

function findEntryIdsByText(entries, text) {
  return entries.filter(entry => entry.text === text).map(entry => entry.id)
}

function findSimilarUltimatumText(text, ultimatumEntries) {
  if (!ultimatumEntries.length) {
    return ''
  }

  const { bestMatch } = stringSimilarity.findBestMatch(text, ultimatumEntries.map(entry => entry.text))

  return bestMatch.rating >= SIMILARITY_THRESHOLD ? bestMatch.target : ''
}

// 同一段敘述可能對應多個 umod ID（例：憤怒亡者 II），全部回傳交由 count 群組取任一命中
function matchUltimatumMod(line, ultimatumEntries, explicitEntries) {
  const ultimatumIds = findEntryIdsByText(ultimatumEntries, line)
  if (ultimatumIds.length) {
    return { ids: ultimatumIds, text: line, type: '通牒', min: '', isValue: false }
  }

  // 怪物傷害／生命為帶數值的隨機詞綴（例：增加 20% 怪物傷害），比對前先還原成 # 樣板
  const explicitIds = findEntryIdsByText(explicitEntries, line.replace(/\d+(?:\.\d+)?/g, '#'))
  if (explicitIds.length) {
    const statValue = parseFloat((line.match(STAT_NUMBER) || [])[0])

    return {
      ids: explicitIds,
      text: line,
      type: '隨機',
      min: Number.isNaN(statValue) ? '' : statValue,
      isValue: true
    }
  }

  const similarText = findSimilarUltimatumText(line, ultimatumEntries)

  return similarText
    ? { ids: findEntryIdsByText(ultimatumEntries, similarText), text: similarText, type: '通牒', min: '', isValue: false }
    : null
}

function resolveChallengeOption(challengeText) {
  const matched = CHALLENGE_OPTIONS.find(item => item.keywords.some(keyword => challengeText.includes(keyword)))

  return matched ? matched.option : ''
}

// 獎勵敘述若非翻倍獻祭或複製稀有物品，即為交換的傳奇物品名稱（ExchangeUnique）
function resolveReward(rewardText) {
  if (!rewardText) {
    return { option: '', uniqueName: '' }
  }
  if (rewardText.includes('命運卡')) {
    return { option: 'DoubleDivCards', uniqueName: '' }
  }
  if (rewardText.includes('通貨') || rewardText.includes('翻倍')) {
    return { option: 'DoubleCurrency', uniqueName: '' }
  }
  if (rewardText.includes('複製') || rewardText.includes('鏡像')) {
    return { option: 'MirrorRare', uniqueName: '' }
  }

  return { option: 'ExchangeUnique', uniqueName: rewardText }
}

function createSearchStat({ id, ids, text, option = '', min = '', max = '', isValue = false, isSearch = false, type = '通牒' }) {
  return {
    id,
    ids,
    text,
    option,
    min,
    max,
    isValue,
    isNegative: false,
    isSearch,
    type,
    isLocked: false
  }
}

function ensureFilterGroup(searchJson, groupKey) {
  if (!searchJson.query.filters[groupKey]) {
    searchJson.query.filters[groupKey] = {
      filters: {},
      disabled: false
    }
  }

  return searchJson.query.filters[groupKey].filters
}

export function analyzeUltimatumCopyText({ itemArray, allStats }) {
  const sections = splitCopySections(itemArray)
  const infoIndex = sections.findIndex(section => findLabelValue(section, CHALLENGE_LABEL))
  const infoLines = infoIndex > -1 ? sections[infoIndex] : []
  const modLines = infoIndex > -1 ? stripModDescriptions(sections[infoIndex + 1] || []) : []

  const ultimatumEntries = getGroupEntries(allStats, 'ultimatum')
  const explicitEntries = getGroupEntries(allStats, 'explicit')

  const challengeText = findLabelValue(infoLines, CHALLENGE_LABEL)
  const rewardText = findLabelValue(infoLines, REWARD_LABEL)
  const inputText = findLabelValue(infoLines, INPUT_LABEL)
  const inputCount = (inputText.match(INPUT_COUNT) || [])[1]
  const reward = resolveReward(rewardText)

  return {
    challengeText,
    challengeOption: resolveChallengeOption(challengeText),
    rewardText,
    rewardOption: reward.option,
    uniqueRewardName: reward.uniqueName,
    inputText,
    // 複製稀有物品的需求獻祭為「可鏡像、稀有物品」，並非可查詢的物品名稱
    inputName: reward.option === 'MirrorRare' ? '' : inputText.replace(INPUT_COUNT, '').trim(),
    inputCount: inputCount ? parseInt(inputCount, 10) : null,
    areaLevel: findLabelNumber(infoLines, AREA_LEVEL_LABEL),
    mods: modLines
      .map(line => matchUltimatumMod(line, ultimatumEntries, explicitEntries))
      .filter(mod => mod)
  }
}

// 挑戰／獎勵／需求獻祭與區域等級不是詞綴，需寫入 query.filters；未勾選查詢時要移除
export function applyUltimatumSearchStat({ searchJson, stat }) {
  if (!ULTIMATUM_SEARCH_STAT_IDS.includes(stat.id)) {
    return false
  }

  const [groupKey, filterKey] = stat.id.split('.')
  const filters = ensureFilterGroup(searchJson, groupKey)

  if (!stat.isSearch) {
    delete filters[filterKey]

    return true
  }

  filters[filterKey] = stat.id === ULTIMATUM_STAT_IDS.areaLevel
    ? {
      min: typeof stat.min === 'number' ? stat.min : null,
      max: typeof stat.max === 'number' ? stat.max : null
    }
    : {
      option: stat.option
    }

  return true
}

export function buildUltimatumSearch({ searchJson, itemArray, allStats, translateType }) {
  const ultimatumInfo = analyzeUltimatumCopyText({
    itemArray,
    allStats
  })
  const searchStats = []

  if (ultimatumInfo.challengeOption) {
    searchStats.push(createSearchStat({
      id: ULTIMATUM_STAT_IDS.challenge,
      text: `${CHALLENGE_LABEL}: ${ultimatumInfo.challengeText}`,
      option: ultimatumInfo.challengeOption,
      isSearch: true
    }))
  }

  if (ultimatumInfo.rewardOption) {
    searchStats.push(createSearchStat({
      id: ULTIMATUM_STAT_IDS.reward,
      text: `${REWARD_LABEL}: ${ultimatumInfo.rewardText}`,
      option: ultimatumInfo.rewardOption,
      isSearch: true
    }))
  }

  if (ultimatumInfo.uniqueRewardName) {
    searchStats.push(createSearchStat({
      id: ULTIMATUM_STAT_IDS.output,
      text: `傳奇獎勵: ${ultimatumInfo.uniqueRewardName}`,
      option: translateType(ultimatumInfo.uniqueRewardName),
      isSearch: true
    }))
  }

  if (ultimatumInfo.inputName) {
    searchStats.push(createSearchStat({
      id: ULTIMATUM_STAT_IDS.input,
      text: `${INPUT_LABEL}: ${ultimatumInfo.inputText}`,
      option: translateType(ultimatumInfo.inputName),
      isSearch: true
    }))
  }

  // 區域等級預設不查詢：同挑戰／獎勵／獻祭的在售物品通常只有少數幾個等級，
  // 鎖定完全相同的區域等級常會查無結果（官方市集也不會預設帶入），改由使用者勾選
  if (typeof ultimatumInfo.areaLevel === 'number') {
    searchStats.push(createSearchStat({
      id: ULTIMATUM_STAT_IDS.areaLevel,
      text: `${AREA_LEVEL_LABEL}: ${ultimatumInfo.areaLevel}`,
      min: ultimatumInfo.areaLevel,
      max: ultimatumInfo.areaLevel,
      isValue: true,
      isSearch: false
    }))
  }

  // 試煉詞綴預設不查詢：同時符合全部詞綴的物品幾乎不存在，改由使用者勾選在意的詞綴
  // 「更多怪物生命」是最後通牒的難度指標，價差明顯，有的話預設帶入查詢
  ultimatumInfo.mods.forEach(mod => {
    searchStats.push(createSearchStat({
      id: mod.ids[0],
      ids: mod.ids,
      text: mod.text,
      min: mod.min,
      isValue: mod.isValue,
      isSearch: mod.text.includes(MONSTER_LIFE_TEXT),
      type: mod.type
    }))
  })

  searchStats.forEach(stat => applyUltimatumSearchStat({
    searchJson,
    stat
  }))

  return {
    searchJson,
    searchStats
  }
}
