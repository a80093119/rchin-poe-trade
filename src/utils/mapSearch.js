export const MAP_QUERY_STAT_IDS = {
  control: 'implicit.stat_1792283443',
  elderGuard: 'implicit.stat_3624393862',
  citadelGuard: 'implicit.stat_2563183002'
}

export const GENERIC_MAP_BASE_TYPES = ['地圖', 'Map']

export const MAP_BASE_TYPE_FALLBACKS = {
  '夢魘地圖': 'Nightmare Map',
  '瓦爾多的地圖': 'Valdo Map',
  '塑界守護者地圖': 'Shaper Guardian Map'
}

const MAP_LOOKUP_STAT_IDS = {
  control: [MAP_QUERY_STAT_IDS.control],
  elderGuard: [MAP_QUERY_STAT_IDS.elderGuard],
  citadelGuard: ['當.stat_2563183002', MAP_QUERY_STAT_IDS.citadelGuard]
}

function flattenCopyLines(lines) {
  return lines
    .flatMap(line => (line || '').split(/\r?\n/))
    .map(line => line.trim())
    .filter(line => line)
}

function getStatsEntryByIds(allStats, statIds) {
  const ids = Array.isArray(statIds) ? statIds : [statIds]

  return allStats.result
    .flatMap(group => group.entries || [])
    .find(entry => ids.includes(entry.id))
}

function getMapHeaderLines(itemArray) {
  const separatorIndex = itemArray.indexOf('--------')
  const headerLines = separatorIndex > -1 ? itemArray.slice(1, separatorIndex) : itemArray.slice(1, 4)

  return flattenCopyLines(headerLines)
}

function extractMapTier(item, itemArray, newLine) {
  const headerText = getMapHeaderLines(itemArray).join('\n')
  const tierMatch = headerText.match(/地圖（階級\s*(\d+)）/)
  if (tierMatch) {
    return parseInt(tierMatch[1], 10)
  }

  let mapPos = item.indexOf('地圖階級:') > -1 ? item.substring(item.indexOf('地圖階級:') + 5) : ''
  if (!mapPos) {
    return null
  }

  let mapPosEnd = mapPos.indexOf(newLine)
  let mapTier = parseInt(mapPos.substring(0, mapPosEnd).trim(), 10)
  return Number.isNaN(mapTier) ? null : mapTier
}

function extractMapAreaLevel(item, itemArray, newLine) {
  const areaLine = flattenCopyLines(itemArray).find(line => /(怪物|地區|區域)等級[：:]\s*\d+/.test(line))
  if (areaLine) {
    const areaMatch = areaLine.match(/(怪物|地區|區域)等級[：:]\s*(\d+)/)
    if (areaMatch) {
      return parseInt(areaMatch[2], 10)
    }
  }

  let areaPos = item.indexOf('地區等級:') > -1 ? item.substring(item.indexOf('地區等級:') + 5) : ''
  if (!areaPos) {
    areaPos = item.indexOf('區域等級:') > -1 ? item.substring(item.indexOf('區域等級:') + 5) : ''
  }
  if (!areaPos) {
    return null
  }

  let areaPosEnd = areaPos.indexOf(newLine)
  let areaTier = parseInt(areaPos.substring(0, areaPosEnd).trim(), 10)
  return Number.isNaN(areaTier) ? null : areaTier
}

function findMapBasicFromCopy(mapBasicOptions, itemArray) {
  const headerLines = getMapHeaderLines(itemArray)
  const sortedOptions = [...mapBasicOptions]
    .filter(option => !GENERIC_MAP_BASE_TYPES.includes(option))
    .sort((left, right) => right.length - left.length)

  return sortedOptions.find(option => {
    const optionZh = option.replace(/[^\u4e00-\u9fa5|．|：]/gi, '')

    return headerLines.some(line => {
      if (line === option || line.includes(option)) {
        return true
      }

      const lineZh = line.replace(/[^\u4e00-\u9fa5|．|：]/gi, '')
      return optionZh && lineZh && lineZh.includes(optionZh)
    })
  }) || ''
}

function findMapStatOption(allStats, statIds, itemArray) {
  const statEntry = getStatsEntryByIds(allStats, statIds)
  const options = statEntry?.option?.options || []
  const allLines = flattenCopyLines(itemArray)

  if (!options.length) {
    return null
  }

  const [prefix = '', suffix = ''] = statEntry.text.split('#')

  return allLines.reduce((matched, line) => {
    if (matched) {
      return matched
    }

    const normalizedLine = line.replace(/\s+\((augmented|implicit|enchant|crafted|fractured|scourge)\)$/, '').trim()
    if (prefix && !normalizedLine.includes(prefix.trim())) {
      return null
    }
    if (suffix && !normalizedLine.includes(suffix.trim())) {
      return null
    }

    const option = options.find(item => normalizedLine.includes(item.text))
    if (!option) {
      return null
    }

    return {
      label: option.text,
      prop: String(option.id)
    }
  }, null)
}

export function analyzeMapCopyText({ item, itemArray, mapBasicOptions, allStats, newLine }) {
  const mapControlOption = findMapStatOption(allStats, MAP_LOOKUP_STAT_IDS.control, itemArray)
    || (item.indexOf('區域被塑界者控制 (implicit)') > -1 ? { label: '塑界者', prop: '1' } : null)
    || (item.indexOf('區域被異界尊師控制 (implicit)') > -1 ? { label: '異界尊師', prop: '2' } : null)

  return {
    mapTier: extractMapTier(item, itemArray, newLine),
    areaTier: extractMapAreaLevel(item, itemArray, newLine),
    matchedMapBasic: findMapBasicFromCopy(mapBasicOptions, itemArray),
    mapControlOption,
    elderGuardOption: findMapStatOption(allStats, MAP_LOOKUP_STAT_IDS.elderGuard, itemArray),
    citadelGuardOption: findMapStatOption(allStats, MAP_LOOKUP_STAT_IDS.citadelGuard, itemArray),
    isBlighted: item.indexOf('凋落的') > -1 || item.indexOf('Blighted') > -1
  }
}