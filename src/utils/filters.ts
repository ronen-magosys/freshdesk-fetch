export const DEFAULT_KEYWORDS = ['sdk', 'api', 'integration'] as const

export const DEFAULT_KEYWORDS_INPUT = 'sdk, api, integration'

export function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function buildKeywordsLabel(keywords: string[]): string {
  if (keywords.length === 0) return 'all tickets'
  return keywords.join(', ')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildKeywordPattern(keywords: string[]): RegExp | null {
  if (keywords.length === 0) return null
  const escaped = keywords.map((keyword) => escapeRegExp(keyword)).join('|')
  return new RegExp(`\\b(?:${escaped})\\b`, 'i')
}

export function textMatchesKeywords(text: string, keywords: string[]): boolean {
  const pattern = buildKeywordPattern(keywords)
  if (!pattern) return true
  return pattern.test(text)
}

export function textsMatchKeywords(texts: string[], keywords: string[]): boolean {
  if (keywords.length === 0) return true
  return texts.some((text) => textMatchesKeywords(text, keywords))
}
