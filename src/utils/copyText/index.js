export {
  normalizeCopyLine,
  parseAdvancedModHeader,
  splitHybridStatLines,
  stripRollRanges,
  stripStatTags
} from './statText'

export {
  COPY_SECTION_SEPARATOR,
  findLabelNumber,
  findLabelValue,
  parseItemCopyText
} from './itemCopyText'

export {
  findBestStat,
  getStatId,
  isOptionStatId,
  resolveLocalStatId
} from './statMatch'
