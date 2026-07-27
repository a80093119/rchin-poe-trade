// 物品詞綴與 stats.json 的比對工具

const stringSimilarity = require('string-similarity')

// stats 陣列的存放方式為 [詞綴文字, 詞綴 ID, 詞綴文字, 詞綴 ID, ...]
// 比對到偶數索引（詞綴文字）時，ID 位於下一筆
function getStatIdIndex(matchedStat) { // 處理判斷到英文詞綴的例外狀況，通常是季初有新詞綴尚未翻譯時才發生
  return (matchedStat.bestMatchIndex % 2 === 0) ? matchedStat.bestMatchIndex + 1 : matchedStat.bestMatchIndex
}

export function getStatId(matchedStat) {
  return matchedStat.ratings[getStatIdIndex(matchedStat)]?.target || ''
}

// 3.27 起 API 把選項式詞綴（星團珠寶附魔、項鍊塗油、禁忌烈焰/血肉、逃脫不能…）
// 由「一筆詞綴 + option 清單」改為 enchant.stat_3948993189|1 這種 id 已含選項的獨立詞綴
export function isOptionStatId(statId) {
  return (statId || '').indexOf('|') > -1
}

export function findBestStat(text, stats) { // 物品上原先詞綴 與 原先詞綴數值用 '#' 取代的兩種字串皆判斷並取最符合那一筆
  let floatValue = []
  let reference = []

  let originalObj = stringSimilarity.findBestMatch(text, stats)
  let modifiedObj = stringSimilarity.findBestMatch(text.replace(/\d+/g, '#'), stats)

  reference.push(originalObj, modifiedObj)
  floatValue.push(originalObj.bestMatch.rating, modifiedObj.bestMatch.rating)

  if (text.includes('減少')) { // 處理物品上原先詞綴包含 '減少' 的情況：因部分詞綴於 api 中只顯示 '增加'，會造成詞綴誤判
    text = text.replace('減少', '增加')
    let specialOriginalObj = stringSimilarity.findBestMatch(text, stats)
    let specialModifiedObj = stringSimilarity.findBestMatch(text.replace(/\d+/g, '#'), stats)
    reference.push(specialOriginalObj, specialModifiedObj)
    floatValue.push(specialOriginalObj.bestMatch.rating, specialModifiedObj.bestMatch.rating)
  }

  let maxFloat = Math.max.apply(null, floatValue);
  let index = floatValue.indexOf(maxFloat);

  return reference[index]
}

// （部分）詞綴對照表：同一段敘述在武器／護甲上是「部分」標籤，其餘裝備則為一般詞綴
const LOCAL_STAT_IDS = [
  { id: 'stat_960081730', localId: 'stat_1940865751', scopes: ['weapon'] }, // 附加 # 至 # 物理傷害
  { id: 'stat_321077055', localId: 'stat_709508406', scopes: ['weapon'] }, // 附加 # 至 # 火焰傷害
  { id: 'stat_3531280422', localId: 'stat_2223678961', scopes: ['weapon'] }, // 附加 # 至 # 混沌傷害
  { id: 'stat_1334060246', localId: 'stat_3336890334', scopes: ['weapon'] }, // 附加 # 至 # 閃電傷害
  { id: 'stat_2387423236', localId: 'stat_1037193709', scopes: ['weapon'] }, // 附加 # 至 # 冰冷傷害
  { id: 'stat_681332047', localId: 'stat_210067635', scopes: ['weapon'] }, // 增加 #% 攻擊速度
  { id: 'stat_803737631', localId: 'stat_691932474', scopes: ['weapon'] }, // +# 命中值
  { id: 'stat_3593843976', localId: 'stat_55876295', scopes: ['weapon'] }, // #% 的物理攻擊傷害偷取生命
  { id: 'stat_3237948413', localId: 'stat_669069897', scopes: ['weapon'] }, // #% 所造成的物理攻擊傷害偷取魔力
  { id: 'stat_2144192055', localId: 'stat_53045048', scopes: ['armour'] }, // # 點閃避值
  { id: 'stat_2106365538', localId: 'stat_124859000', scopes: ['armour'] }, // 增加 #% 閃避值
  { id: 'stat_809229260', localId: 'stat_3484657501', scopes: ['armour'] }, // # 點護甲
  { id: 'stat_2866361420', localId: 'stat_1062208444', scopes: ['armour'] }, // 增加 #% 護甲
  { id: 'stat_3489782002', localId: 'stat_4052037485', scopes: ['armour'] }, // # 最大能量護盾
  // 台服兩詞綴同為「增加 #% 生命回復率」：腰帶、護甲為 Recovery rate，其餘為 Regeneration rate
  { id: 'stat_44972811', localId: 'stat_3240073117', scopes: ['belt', 'chest'] }
]

export function resolveLocalStatId(statId, categoryProp = '') {
  const matched = LOCAL_STAT_IDS.find(entry => statId.indexOf(entry.id) > -1 || statId.indexOf(entry.localId) > -1)

  if (!matched) {
    return statId
  }

  const isLocal = matched.scopes.some(scope => categoryProp.indexOf(scope) > -1)

  return `${statId.split('.')[0]}.${isLocal ? matched.localId : matched.id}`
}
