// 劫盜物品（藍圖 / 契約書）查詢：
// 把複製文字的劫盜目標價值、需求技能等級、已揭露側廂／逃脫路線／暗房與地區等級
// 轉為官方 API 的 heist_filters，附魔則沿用 enchant 詞綴 ID

import { analyzeMapCopyText } from './mapSearch'

const stringSimilarity = require('string-similarity')

export const HEIST_STAT_ID_PREFIX = 'heist.'

// 「劫盜目標：禁忌之燈 (高等價值)」括號內的價值對應 heist_objective_value 選項
const HEIST_OBJECTIVE_VALUE_OPTIONS = [
  { text: '中等價值', option: 'moderate' },
  { text: '高等價值', option: 'high' },
  { text: '珍寶', option: 'precious' },
  { text: '無價', option: 'priceless' }
]

// 「需要 拆除 (等級 1)」的技能名稱對應各 heist_* 等級篩選
// 順序即比對優先序：陷阱拆除 內含 拆除，長字串需先比對
const HEIST_JOB_FILTERS = [
  { label: '陷阱拆除', filterKey: 'heist_trap_disarmament' },
  { label: '解咒師', filterKey: 'heist_counter_thaumaturgy' },
  { label: '洞察力', filterKey: 'heist_perception' },
  { label: '開鎖', filterKey: 'heist_lockpicking' },
  { label: '蠻力', filterKey: 'heist_brute_force' },
  { label: '拆除', filterKey: 'heist_demolition' },
  { label: '靈巧', filterKey: 'heist_agility' },
  { label: '詐欺', filterKey: 'heist_deception' },
  { label: '工程', filterKey: 'heist_engineering' }
]

// 藍圖的「已揭露 X: 2/4」皆為「已揭露數 / 總數」，兩者各自對應一組篩選
const HEIST_ROOM_FILTERS = [
  {
    pattern: /已揭露側[廂箱][：:]\s*(\d+)\s*\/\s*(\d+)/,
    revealed: { filterKey: 'heist_wings', text: '已揭露側廂' },
    total: { filterKey: 'heist_max_wings', text: '總側廂' }
  },
  {
    pattern: /已揭露逃[脫跑]路線[：:]\s*(\d+)\s*\/\s*(\d+)/,
    revealed: { filterKey: 'heist_escape_routes', text: '已揭露逃脫路線' },
    total: { filterKey: 'heist_max_escape_routes', text: '總逃脫路線' }
  },
  {
    pattern: /已揭露暗房[：:]\s*(\d+)\s*\/\s*(\d+)/,
    revealed: { filterKey: 'heist_reward_rooms', text: '已揭露暗房' },
    total: { filterKey: 'heist_max_reward_rooms', text: '總暗房' }
  }
]

const HEIST_OBJECTIVE_LINE = /^劫盜目標\s*[：:]\s*(.+)$/
const HEIST_OBJECTIVE_VALUE = /[（(]([^（()）]+)[)）]\s*$/
const HEIST_JOB_LINE = /^需要\s*(.+?)\s*[（(]\s*等級\s*(\d+)\s*[)）]\s*$/
const HEIST_OBJECTIVE_STAT_ID = `${HEIST_STAT_ID_PREFIX}heist_objective_value`

function flattenCopyLines(lines) {
  return lines
    .flatMap(line => (line || '').split(/\r?\n/))
    .map(line => line.trim())
    .filter(line => line)
}

function normalizeStatText(text) {
  return (text || '')
    .replace(/\s+\((augmented|implicit|enchant|crafted|fractured|scourge|unmet)\)$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function findLineValue(lines, pattern) {
  const matchedLine = lines.find(line => pattern.test(line))
  if (!matchedLine) {
    return null
  }

  const matchedValue = matchedLine.match(pattern)
  return matchedValue || null
}

function findMatchingEnchantStats(allStats, lines) {
  const enchantEntries = allStats.result
    .flatMap(group => group.entries || [])
    .filter(entry => entry.type === 'enchant')

  return lines.reduce((matchedStats, line) => {
    if (!line.includes('(enchant)')) {
      return matchedStats
    }

    const normalizedLine = normalizeStatText(line)
    const matchedEntry = findBestEnchantEntry(normalizedLine, enchantEntries)

    if (!matchedEntry || matchedStats.some(entry => entry.id === matchedEntry.id)) {
      return matchedStats
    }

    matchedStats.push({
      id: matchedEntry.id,
      text: matchedEntry.text,
      type: matchedEntry.type
    })

    return matchedStats
  }, [])
}

function isTemplateMatch(text, entryText) {
  if (!entryText.includes('#')) {
    return normalizeStatText(entryText) === text
  }

  const [prefix = '', suffix = ''] = entryText.split('#')
  const normalizedPrefix = normalizeStatText(prefix)
  const normalizedSuffix = normalizeStatText(suffix)

  if (normalizedPrefix && !text.includes(normalizedPrefix)) {
    return false
  }

  if (normalizedSuffix && !text.includes(normalizedSuffix)) {
    return false
  }

  return true
}

function getBestSimilarityScore(text, entryText) {
  const originalScore = stringSimilarity.compareTwoStrings(text, normalizeStatText(entryText))
  const templatedScore = stringSimilarity.compareTwoStrings(text.replace(/\d+/g, '#'), normalizeStatText(entryText))

  if (!text.includes('減少')) {
    return Math.max(originalScore, templatedScore)
  }

  const increasedText = text.replace('減少', '增加')
  const increasedScore = stringSimilarity.compareTwoStrings(increasedText, normalizeStatText(entryText))
  const increasedTemplatedScore = stringSimilarity.compareTwoStrings(increasedText.replace(/\d+/g, '#'), normalizeStatText(entryText))

  return Math.max(originalScore, templatedScore, increasedScore, increasedTemplatedScore)
}

function findBestEnchantEntry(text, enchantEntries) {
  const exactEntry = enchantEntries.find(entry => isTemplateMatch(text, entry.text))
  if (exactEntry) {
    return exactEntry
  }

  const rankedEntries = enchantEntries
    .map(entry => ({
      entry,
      score: getBestSimilarityScore(text, entry.text)
    }))
    .sort((left, right) => right.score - left.score)

  return rankedEntries[0]?.score >= 0.9 ? rankedEntries[0].entry : null
}

function hasNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value)
}

function ensureStatFilters(searchJson) {
  if (!searchJson.query.stats.length) {
    searchJson.query.stats = [{ type: 'and', filters: [] }]
  }

  return searchJson.query.stats[0].filters
}

function setQueryStatFilter(searchJson, statId, value) {
  const filters = ensureStatFilters(searchJson)
  const nextFilter = { id: statId }
  const currentIndex = filters.findIndex(filter => filter.id === statId)

  if (value && Object.keys(value).length > 0) {
    nextFilter.value = value
  }

  if (currentIndex > -1) {
    filters.splice(currentIndex, 1, nextFilter)
  } else {
    filters.push(nextFilter)
  }
}

function ensureHeistFilters(searchJson) {
  if (!searchJson.query.filters.heist_filters) {
    searchJson.query.filters.heist_filters = {
      filters: {},
      disabled: false
    }
  }

  return searchJson.query.filters.heist_filters.filters
}

function formatHeistBaseType(matchedMapBasic, isTwServer) {
  if (!matchedMapBasic) {
    return '無'
  }

  return isTwServer ? matchedMapBasic.replace(/[^一-龥|．|：]/gi, '') : matchedMapBasic
}

function createSearchStatEntry({ id, text, option = '', min = '', max = '', type = '劫盜', isValue = true, isSearch = true, isLocked = false }) {
  return {
    id,
    text,
    option,
    min,
    max,
    isValue,
    isNegative: false,
    isSearch,
    type,
    isLocked
  }
}

function findObjectiveValue(lines) {
  const objectiveMatch = findLineValue(lines, HEIST_OBJECTIVE_LINE)
  if (!objectiveMatch) {
    return { objectiveText: '', valueText: '', valueOption: '' }
  }

  const objectiveText = objectiveMatch[1].trim()
  const valueText = (objectiveText.match(HEIST_OBJECTIVE_VALUE) || [])[1] || ''
  const matchedOption = HEIST_OBJECTIVE_VALUE_OPTIONS.find(item => valueText.includes(item.text))

  return {
    objectiveText,
    valueText,
    valueOption: matchedOption ? matchedOption.option : ''
  }
}

// 一張藍圖可同時需要多種技能，重複的技能只留等級最高的一筆
function findJobRequirements(lines) {
  return lines.reduce((jobs, line) => {
    const jobMatch = line.match(HEIST_JOB_LINE)
    if (!jobMatch) {
      return jobs
    }

    const matchedJob = HEIST_JOB_FILTERS.find(job => jobMatch[1].includes(job.label))
    const level = parseInt(jobMatch[2], 10)
    if (!matchedJob || Number.isNaN(level)) {
      return jobs
    }

    const currentJob = jobs.find(job => job.filterKey === matchedJob.filterKey)
    if (!currentJob) {
      jobs.push({
        filterKey: matchedJob.filterKey,
        label: matchedJob.label,
        level
      })
    } else if (level > currentJob.level) {
      currentJob.level = level
    }

    return jobs
  }, [])
}

function findRoomCounts(lines) {
  return HEIST_ROOM_FILTERS.reduce((rooms, roomFilter) => {
    const roomMatch = findLineValue(lines, roomFilter.pattern)
    if (!roomMatch) {
      return rooms
    }

    rooms.push({
      revealed: { ...roomFilter.revealed, count: parseInt(roomMatch[1], 10) },
      total: { ...roomFilter.total, count: parseInt(roomMatch[2], 10) }
    })

    return rooms
  }, [])
}

export function analyzeHeistCopyText({ itemArray, allStats }) {
  const allLines = flattenCopyLines(itemArray)
  const areaLevelMatch = findLineValue(allLines, /(地區|區域)等級[：:]\s*(\d+)/)
  const rooms = findRoomCounts(allLines)
  const sideRooms = rooms.find(room => room.revealed.filterKey === 'heist_wings')
  const objective = findObjectiveValue(allLines)

  return {
    areaLevel: areaLevelMatch ? parseInt(areaLevelMatch[2], 10) : null,
    // 保留舊有欄位名稱，避免既有藍圖流程的相依性
    revealedSideRooms: sideRooms ? {
      revealed: sideRooms.revealed.count,
      total: sideRooms.total.count
    } : null,
    rooms,
    objectiveText: objective.objectiveText,
    objectiveValueText: objective.valueText,
    objectiveValueOption: objective.valueOption,
    jobs: findJobRequirements(allLines),
    enchantStats: findMatchingEnchantStats(allStats, allLines)
  }
}

// 劫盜條件皆為 query.filters.heist_filters 而非詞綴，需在勾選變動時自行寫入／移除
export function applyHeistSearchStat({ searchJson, stat }) {
  if (!stat.id || !stat.id.startsWith(HEIST_STAT_ID_PREFIX)) {
    return false
  }

  const filters = ensureHeistFilters(searchJson)
  const filterKey = stat.id.slice(HEIST_STAT_ID_PREFIX.length)

  if (!stat.isSearch) {
    delete filters[filterKey]

    return true
  }

  filters[filterKey] = stat.id === HEIST_OBJECTIVE_STAT_ID
    ? { option: stat.option }
    : {
      min: hasNumber(stat.min) ? stat.min : null,
      max: hasNumber(stat.max) ? stat.max : null
    }

  return true
}

export function buildHeistSearch({
  searchJson,
  item,
  itemArray,
  rarity,
  allStats,
  mapBasicOptions,
  newLine,
  isTwServer,
  translateType
}) {
  const mapInfo = analyzeMapCopyText({
    item,
    itemArray,
    mapBasicOptions,
    allStats,
    newLine
  })
  const heistInfo = analyzeHeistCopyText({
    itemArray,
    allStats
  })
  const matchedMapBasic = mapInfo.matchedMapBasic || ''
  const isUnique = rarity === '傳奇'

  searchJson.query.filters.type_filters.filters.rarity = {
    option: isUnique ? 'unique' : 'nonunique'
  }
  searchJson.query.filters.misc_filters.filters.corrupted = {
    option: item.indexOf('已汙染') > -1 ? 'true' : 'false'
  }

  if (hasNumber(heistInfo.areaLevel)) {
    searchJson.query.filters.misc_filters.filters.ilvl = {
      min: heistInfo.areaLevel,
      max: heistInfo.areaLevel
    }
  }

  if (matchedMapBasic) {
    searchJson.query.type = translateType(matchedMapBasic)
  }

  // 傳奇藍圖／契約書（例：契約書：攻破不破者）以名稱查詢才不會混入同基底的一般任務
  if (isUnique && itemArray[1] && itemArray[1] !== matchedMapBasic) {
    searchJson.query.name = translateType(itemArray[1])
  }

  heistInfo.enchantStats.forEach(stat => {
    setQueryStatFilter(searchJson, stat.id)
  })

  const searchStats = []

  if (hasNumber(heistInfo.areaLevel)) {
    searchStats.push(createSearchStatEntry({
      id: 'misc.ilvl',
      text: '物品等級',
      min: heistInfo.areaLevel,
      max: heistInfo.areaLevel,
      type: '物品'
    }))
  }

  if (heistInfo.objectiveValueOption) {
    searchStats.push(createSearchStatEntry({
      id: HEIST_OBJECTIVE_STAT_ID,
      text: `劫盜目標：${heistInfo.objectiveText}`,
      option: heistInfo.objectiveValueOption,
      isValue: false
    }))
  }

  heistInfo.rooms.forEach(room => {
    [room.revealed, room.total].forEach(roomCount => {
      if (!hasNumber(roomCount.count)) {
        return
      }

      searchStats.push(createSearchStatEntry({
        id: `${HEIST_STAT_ID_PREFIX}${roomCount.filterKey}`,
        text: roomCount.text,
        min: roomCount.count,
        max: roomCount.count
      }))
    })
  })

  // 需求技能等級只給最小值：等級較高的任務同樣符合買家需求
  heistInfo.jobs.forEach(job => {
    searchStats.push(createSearchStatEntry({
      id: `${HEIST_STAT_ID_PREFIX}${job.filterKey}`,
      text: `需要 ${job.label} 等級`,
      min: job.level
    }))
  })

  heistInfo.enchantStats.forEach(stat => {
    searchStats.push(createSearchStatEntry({
      id: stat.id,
      text: stat.text,
      type: '附魔',
      isValue: false,
      isLocked: true
    }))
  })

  searchStats.forEach(stat => applyHeistSearchStat({
    searchJson,
    stat
  }))

  return {
    searchJson,
    searchStats,
    uiState: {
      isMap: true,
      isMapCollapse: true,
      mapCategory: {
        isShaper: false,
        isElder: false,
        isCitadel: false,
        isBlighted: false
      },
      raritySet: {
        chosenObj: isUnique ? {
          label: '傳奇',
          prop: 'unique'
        } : {
          label: '非傳奇',
          prop: 'nonunique'
        },
        isSearch: true
      },
      itemLevel: {
        min: hasNumber(heistInfo.areaLevel) ? heistInfo.areaLevel : '',
        max: hasNumber(heistInfo.areaLevel) ? heistInfo.areaLevel : '',
        isSearch: hasNumber(heistInfo.areaLevel)
      },
      mapBasic: {
        chosenM: formatHeistBaseType(matchedMapBasic, isTwServer),
        isSearch: Boolean(matchedMapBasic)
      }
    }
  }
}
