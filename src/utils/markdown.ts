import {
  formatUtcDateTime,
  getConversationAuthorName,
  getConversationBody,
  getConversationTypeLabel,
  getTicketDescription,
  PRIORITY_LABELS,
  STATUS_LABELS,
  ticketUrl,
} from '../api/freshdesk'
import type { Conversation, EnrichedTicket } from '../api/types'
import { buildKeywordsLabel } from './filters'

function formatConversationSection(
  ticket: EnrichedTicket,
  conversations: Conversation[],
  userNames: Map<number, string>,
): string[] {
  const lines: string[] = ['### Conversation', '']

  const description = getTicketDescription(ticket)
  lines.push(
    `**${ticket.requesterName}** · Opening message · ${formatUtcDateTime(ticket.created_at)}`,
  )
  lines.push('')
  lines.push(description || '(No description.)')
  lines.push('')

  for (const conversation of conversations) {
    const author = getConversationAuthorName(conversation, ticket, userNames)
    const typeLabel = getConversationTypeLabel(conversation)
    const body = getConversationBody(conversation)

    lines.push(`**${author}** · ${typeLabel} · ${formatUtcDateTime(conversation.created_at)}`)
    lines.push('')
    lines.push(body || '(Empty message.)')
    lines.push('')
  }

  return lines
}

export function buildTicketsMarkdown(
  tickets: EnrichedTicket[],
  from: string,
  to: string,
  domain: string,
  conversationsByTicketId: Map<number, Conversation[]>,
  userNames: Map<number, string>,
  keywords: string[],
): string {
  const label = buildKeywordsLabel(keywords)
  const lines: string[] = [
    `# Tickets created ${from} to ${to} (${tickets.length} matching ${label})`,
    '',
  ]

  for (const ticket of tickets) {
    const status = STATUS_LABELS[ticket.status] ?? `Status ${ticket.status}`
    const priority = PRIORITY_LABELS[ticket.priority] ?? `Priority ${ticket.priority}`
    const url = ticketUrl(domain, ticket.id)
    const conversations = conversationsByTicketId.get(ticket.id) ?? []

    lines.push(`## [#${ticket.id}](${url}) ${ticket.subject}`)
    lines.push(`- Status: ${status}`)
    lines.push(`- Priority: ${priority}`)
    lines.push(`- Requester: ${ticket.requesterName}`)
    lines.push(`- Agent: ${ticket.agentName}`)
    lines.push(`- Created: ${formatUtcDateTime(ticket.created_at)}`)
    lines.push(`- Due: ${formatUtcDateTime(ticket.due_by)}`)
    lines.push('')
    lines.push(...formatConversationSection(ticket, conversations, userNames))
    lines.push(`## End [#${ticket.id}]`)
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

export function collapseConsecutiveBlankLines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

export function downloadMarkdown(content: string, filename: string): void {
  const normalized = collapseConsecutiveBlankLines(content)
  const blob = new Blob([normalized], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
