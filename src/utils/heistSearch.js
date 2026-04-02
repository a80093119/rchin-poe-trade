import { analyzeMapCopyText } from './mapSearch'

const stringSimilarity = require('string-similarity')

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

function formatBlueprintBaseType(matchedMapBasic, isTwServer) {
  if (!matchedMapBasic) {
    return '無'
  }

  return isTwServer ? matchedMapBasic.replace(/[^\u4e00-\u9fa5|．|：]/gi, '') : matchedMapBasic
}

function createSearchStatEntry({ id, text, min = '', max = '', type = '藍圖', isValue = true, isLocked = false }) {
  return {
    id,
    text,
    option: '',
    min,
    max,
    isValue,
    isNegative: false,
    isSearch: true,
    type,
    isLocked
  }
}

export function analyzeHeistCopyText({ itemArray, allStats }) {
  const allLines = flattenCopyLines(itemArray)
  const areaLevelMatch = findLineValue(allLines, /(地區|區域)等級[：:]\s*(\d+)/)
  const revealedSideRoomsMatch = findLineValue(allLines, /已揭露側[廂箱][：:]\s*(\d+)\s*\/\s*(\d+)/)

  return {
    areaLevel: areaLevelMatch ? parseInt(areaLevelMatch[2], 10) : null,
    revealedSideRooms: revealedSideRoomsMatch ? {
      revealed: parseInt(revealedSideRoomsMatch[1], 10),
      total: parseInt(revealedSideRoomsMatch[2], 10)
    } : null,
    enchantStats: findMatchingEnchantStats(allStats, allLines)
  }
}

export function buildBlueprintSearch({
  searchJson,
  item,
  itemArray,
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

  searchJson.query.filters.type_filters.filters.rarity = {
    option: 'nonunique'
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

  const heistFilters = ensureHeistFilters(searchJson)

  if (hasNumber(heistInfo.revealedSideRooms?.total)) {
    heistFilters.heist_max_wings = {
      min: heistInfo.revealedSideRooms.total,
      max: heistInfo.revealedSideRooms.total
    }
  }

  if (hasNumber(heistInfo.revealedSideRooms?.revealed)) {
    heistFilters.heist_wings = {
      min: heistInfo.revealedSideRooms.revealed,
      max: heistInfo.revealedSideRooms.revealed
    }
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

  if (hasNumber(heistInfo.revealedSideRooms?.revealed)) {
    searchStats.push(createSearchStatEntry({
      id: 'heist.heist_wings',
      text: '已揭露側廂',
      min: heistInfo.revealedSideRooms.revealed,
      max: heistInfo.revealedSideRooms.revealed
    }))
  }

  if (hasNumber(heistInfo.revealedSideRooms?.total)) {
    searchStats.push(createSearchStatEntry({
      id: 'heist.heist_max_wings',
      text: '總側廂',
      min: heistInfo.revealedSideRooms.total,
      max: heistInfo.revealedSideRooms.total
    }))
  }

  heistInfo.enchantStats.forEach(stat => {
    searchStats.push(createSearchStatEntry({
      id: stat.id,
      text: stat.text,
      type: '附魔',
      isValue: false,
      isLocked: true
    }))
  })

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
        chosenObj: {
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
        chosenM: formatBlueprintBaseType(matchedMapBasic, isTwServer),
        isSearch: Boolean(matchedMapBasic)
      }
    }
  }
}