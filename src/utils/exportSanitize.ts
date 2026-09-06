import {
  getConversationAuthorName,
  getConversationBody,
  getTicketDescription,
} from '../api/freshdesk'
import type { Conversation, EnrichedTicket } from '../api/types'
import {
  buildKeywordsLabel,
  textsMatchKeywords,
} from './filters'

export { DEFAULT_KEYWORDS, DEFAULT_KEYWORDS_INPUT } from './filters'
export { buildKeywordsLabel } from './filters'

const EMAIL_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

const URL_CREDENTIALS_PATTERN =
  /(?:https?:\/\/)?[A-Za-z0-9._%+-]+:[^@\s/]+@[^\s]+|\?(?:[^=\s&]+=[^&\s]*&)*(?:token|key|password|apikey|api_key|secret)=[^&\s]*/gi

const LABELED_SECRET_PATTERN =
  /\b(?:password|passwd|pwd|api[\s_-]?key|token|bearer|secret|access[\s_-]?key)\s*[:=]\s*\S+/gi

const SECRET_PREFIX_PATTERN =
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}\b/g

const PHONE_PATTERN =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,6})?/g

const IPV4_PATTERN =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})\b/g

const REMOTE_PRODUCT_PATTERN = /\b(?:anydesk|teamviewer|team\s*viewer)\b/i

const REMOTE_ID_PATTERN =
  /\b(?:\d{3}[\s.-]?){2}\d{3,4}\b|\b\d{9,10}\b/g

const REMOTE_PASSWORD_PATTERN =
  /\b(?:password|passwd|pwd|pass(?:word)?)\s*[:=]\s*\S+/gi

export interface ExportPrepareResult {
  tickets: EnrichedTicket[]
  conversationsByTicketId: Map<number, Conversation[]>
  userNames: Map<number, string>
  totalCount: number
  matchedCount: number
}

interface NameReplacement {
  name: string
  replacement: string
}

function ticketMatchesKeywordsForExport(
  ticket: EnrichedTicket,
  conversations: Conversation[],
  keywords: string[],
): boolean {
  if (keywords.length === 0) return true
  const texts = [
    ticket.subject,
    getTicketDescription(ticket),
    ...conversations.map((conversation) => getConversationBody(conversation)),
  ]

  return textsMatchKeywords(texts, keywords)
}

function isPlaceholderName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length === 0 || trimmed === 'Unassigned' || /^#\d+$/.test(trimmed)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceAll(text: string, pattern: RegExp, replacement: string): string {
  return text.replace(pattern, replacement)
}

function redactRemoteAccess(text: string): string {
  let result = text

  result = replaceAll(result, REMOTE_PASSWORD_PATTERN, '[PASSWORD]')

  const productMatches = [...result.matchAll(new RegExp(REMOTE_PRODUCT_PATTERN.source, 'gi'))]
  for (const match of productMatches) {
    const index = match.index ?? 0
    const start = Math.max(0, index - 80)
    const end = Math.min(result.length, index + match[0].length + 120)
    const segment = result.slice(start, end)
    const redactedSegment = segment.replace(REMOTE_ID_PATTERN, '[REMOTE_ID]')
    result = result.slice(0, start) + redactedSegment + result.slice(end)
  }

  return result
}

function redactKnownNames(text: string, replacements: NameReplacement[]): string {
  let result = text
  const sorted = [...replacements].sort((a, b) => b.name.length - a.name.length)

  for (const { name, replacement } of sorted) {
    if (isPlaceholderName(name)) continue
    const pattern = new RegExp(escapeRegExp(name), 'gi')
    result = result.replace(pattern, replacement)
  }

  return result
}

export function redactSensitiveText(
  text: string,
  nameReplacements: NameReplacement[] = [],
): string {
  if (!text) return text

  let result = text
  result = redactRemoteAccess(result)
  result = replaceAll(result, EMAIL_PATTERN, '[EMAIL]')
  result = replaceAll(result, URL_CREDENTIALS_PATTERN, '[REDACTED]')
  result = replaceAll(result, LABELED_SECRET_PATTERN, '[SECRET]')
  result = replaceAll(result, SECRET_PREFIX_PATTERN, '[SECRET]')
  result = replaceAll(result, PHONE_PATTERN, '[PHONE]')
  result = replaceAll(result, IPV4_PATTERN, '[IP]')
  result = redactKnownNames(result, nameReplacements)

  return result
}

function collectNameReplacements(
  ticket: EnrichedTicket,
  conversations: Conversation[],
  userNames: Map<number, string>,
): NameReplacement[] {
  const replacements: NameReplacement[] = []
  const seen = new Set<string>()

  const addName = (name: string, replacement: string) => {
    const trimmed = name.trim()
    if (isPlaceholderName(trimmed) || seen.has(trimmed.toLowerCase())) return
    seen.add(trimmed.toLowerCase())
    replacements.push({ name: trimmed, replacement })
  }

  addName(ticket.requesterName, '[Requester]')
  if (ticket.agentName !== 'Unassigned') {
    addName(ticket.agentName, '[Agent]')
  }

  for (const conversation of conversations) {
    const author = getConversationAuthorName(conversation, ticket, userNames)
    if (author === ticket.requesterName) continue
    if (author === ticket.agentName) continue
    addName(author, '[Person]')
  }

  return replacements
}

function cloneConversation(
  conversation: Conversation,
  redactedBody: string,
): Conversation {
  return {
    ...conversation,
    body_text: redactedBody,
    body: redactedBody,
  }
}

function cloneRedactedTicket(
  ticket: EnrichedTicket,
  conversations: Conversation[],
  userNames: Map<number, string>,
): { ticket: EnrichedTicket; conversations: Conversation[]; userNames: Map<number, string> } {
  const nameReplacements = collectNameReplacements(ticket, conversations, userNames)
  const redactedDescription = redactSensitiveText(getTicketDescription(ticket), nameReplacements)
  const redactedSubject = redactSensitiveText(ticket.subject, nameReplacements)

  const redactedConversations = conversations.map((conversation) => {
    const body = getConversationBody(conversation)
    const redactedBody = redactSensitiveText(body, nameReplacements)
    return cloneConversation(conversation, redactedBody)
  })

  const redactedTicket: EnrichedTicket = {
    ...ticket,
    subject: redactedSubject,
    description_text: redactedDescription,
    description: redactedDescription,
    requesterName: '[Requester]',
    agentName: ticket.agentName === 'Unassigned' ? 'Unassigned' : '[Agent]',
  }

  const redactedUserNames = new Map(userNames)
  for (const [id, name] of redactedUserNames) {
    if (name === ticket.requesterName) {
      redactedUserNames.set(id, '[Requester]')
    } else if (name === ticket.agentName && ticket.agentName !== 'Unassigned') {
      redactedUserNames.set(id, '[Agent]')
    } else if (
      !isPlaceholderName(name) &&
      nameReplacements.some(
        (replacement) =>
          replacement.replacement === '[Person]' &&
          replacement.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      redactedUserNames.set(id, '[Person]')
    }
  }

  return {
    ticket: redactedTicket,
    conversations: redactedConversations,
    userNames: redactedUserNames,
  }
}

export function prepareExportForDownload(
  tickets: EnrichedTicket[],
  conversationsByTicketId: Map<number, Conversation[]>,
  userNames: Map<number, string>,
  keywords: string[],
): ExportPrepareResult {
  const totalCount = tickets.length
  const matchedTickets: EnrichedTicket[] = []
  const matchedConversations = new Map<number, Conversation[]>()
  let mergedUserNames = new Map(userNames)

  for (const ticket of tickets) {
    const conversations = conversationsByTicketId.get(ticket.id) ?? []
    if (!ticketMatchesKeywordsForExport(ticket, conversations, keywords)) continue

    const redacted = cloneRedactedTicket(ticket, conversations, userNames)
    matchedTickets.push(redacted.ticket)
    matchedConversations.set(ticket.id, redacted.conversations)
    mergedUserNames = redacted.userNames
  }

  return {
    tickets: matchedTickets,
    conversationsByTicketId: matchedConversations,
    userNames: mergedUserNames,
    totalCount,
    matchedCount: matchedTickets.length,
  }
}

export function buildNoMatchesMarkdown(
  from: string,
  to: string,
  totalCount: number,
  keywords: string[],
): string {
  const label = buildKeywordsLabel(keywords)
  return [
    `# Tickets created ${from} to ${to} (0 matching ${label})`,
    '',
    `No tickets in this export matched the keywords: ${keywords.join(', ')}.`,
    '',
    `Total tickets in scope: ${totalCount}`,
    '',
  ].join('\n')
}

export function buildExportSuccessMessage(
  matchedCount: number,
  totalCount: number,
  keywords: string[],
): string {
  if (keywords.length === 0) {
    return `Exported ${matchedCount} tickets (PII redacted).`
  }
  const label = buildKeywordsLabel(keywords)
  return `Exported ${matchedCount} of ${totalCount} tickets matching ${label} (PII redacted).`
}
