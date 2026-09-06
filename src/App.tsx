import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled, { css, keyframes } from 'styled-components'
import {
  countInclusiveDays,
  createTicketFetchCaches,
  defaultDateRange,
  fetchAllTicketsInRange,
  fetchAppConfig,
  fetchFreshdeskTags,
  fetchTicketConversations,
  fetchTicketPage,
  formatUtcDateTime,
  getConversationAuthorName,
  getConversationBody,
  getConversationTypeLabel,
  getTicketDescription,
  previewTicketSearch,
  PRIORITY_LABELS,
  STATUS_LABELS,
  ticketUrl,
  type TicketFetchFilters,
  UI_PAGE_SIZE,
  validateFetchFilters,
  WARN_CONVERSATIONS_DOWNLOAD,
  WARN_DATE_RANGE_DAYS,
  WARN_TICKETS,
  type TicketFetchCaches,
} from './api/freshdesk'
import {
  FreshdeskApiError,
  type Conversation,
  type EnrichedTicket,
  type FetchProgress,
} from './api/types'
import { ChipSelect } from './components/ChipSelect'
import {
  buildExportSuccessMessage,
  buildNoMatchesMarkdown,
  prepareExportForDownload,
} from './utils/exportSanitize'
import { buildTicketsMarkdown, downloadMarkdown } from './utils/markdown'
import { DEFAULT_KEYWORDS } from './utils/filters'

const GlobalStyle = styled.div`
  min-height: 100vh;
  background: #f5f7f9;
  color: #183247;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
    sans-serif;
`

const Header = styled.header`
  background: #12344d;
  color: #fff;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12);
`

const Title = styled.h1`
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
`

const DomainBadge = styled.span`
  font-size: 0.85rem;
  opacity: 0.85;
`

const Main = styled.main`
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
`

const Toolbar = styled.div`
  background: #fff;
  border: 1px solid #cfd7df;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  margin-bottom: 16px;
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #475867;
`

const Input = styled.input`
  border: 1px solid #cfd7df;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 0.95rem;
  min-width: 160px;

  &:focus {
    outline: 2px solid #2c5cc5;
    border-color: #2c5cc5;
  }
`

const Button = styled.button<{ $variant?: 'primary' | 'secondary' }>`
  border: none;
  border-radius: 4px;
  padding: 9px 16px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;

  ${({ $variant = 'primary' }) =>
    $variant === 'primary'
      ? css`
          background: #2c5cc5;
          color: #fff;
          &:hover:not(:disabled) {
            background: #244ea3;
          }
        `
      : css`
          background: #fff;
          color: #2c5cc5;
          border: 1px solid #2c5cc5;
          &:hover:not(:disabled) {
            background: #ebf0fb;
          }
        `}

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const TooltipWrap = styled.span`
  position: relative;
  display: inline-flex;

  &:hover > [data-tooltip-bubble],
  &:focus-within > [data-tooltip-bubble] {
    opacity: 1;
    visibility: visible;
  }
`

const TooltipBubble = styled.span`
  position: absolute;
  left: 50%;
  top: calc(100% + 8px);
  transform: translateX(-50%);
  background: #183247;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.35;
  padding: 6px 10px;
  border-radius: 4px;
  max-width: 240px;
  width: max-content;
  text-align: center;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.12s ease,
    visibility 0.12s ease;
  z-index: 20;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);

  &::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 100%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-bottom-color: #183247;
  }
`

const StatusBar = styled.div<{ $tone: 'info' | 'warn' | 'error' }>`
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 0.92rem;

  ${({ $tone }) => {
    switch ($tone) {
      case 'error':
        return css`
          background: #fdecea;
          color: #b42318;
          border: 1px solid #f5c2c0;
        `
      case 'warn':
        return css`
          background: #fff8e6;
          color: #8a6116;
          border: 1px solid #f2dfa1;
        `
      default:
        return css`
          background: #e8f4fd;
          color: #1f4e79;
          border: 1px solid #b8daf5;
        `
    }
  }}
`

const Panel = styled.section`
  background: #fff;
  border: 1px solid #cfd7df;
  border-radius: 8px;
  overflow: hidden;
`

const PanelHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid #ebeff3;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
`

const SearchInput = styled(Input)`
  min-width: 240px;
`

const Pager = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid #ebeff3;
  background: #fafbfc;
`

const PagerText = styled.span`
  font-size: 0.9rem;
  color: #475867;
  min-width: 120px;
  text-align: center;
`

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`

const TableWrap = styled.div`
  position: relative;
  overflow-x: auto;
`

const TableContent = styled.div<{ $dimmed?: boolean }>`
  transition: opacity 0.15s ease;
  opacity: ${({ $dimmed }) => ($dimmed ? 0.45 : 1)};
`

const TableLoadingOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.75);
  z-index: 1;
`

const TableLoadingIndicator = styled.div<{ $top: number }>`
  position: absolute;
  top: ${({ $top }) => $top}px;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  z-index: 2;
  pointer-events: none;
`

const TableSpinner = styled.div`
  width: 32px;
  height: 32px;
  border: 3px solid #e8ecf0;
  border-top-color: #2c5cc5;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
`

const TableLoadingText = styled.span`
  font-size: 0.9rem;
  color: #475867;
  font-weight: 500;
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
`

const Th = styled.th`
  text-align: left;
  padding: 10px 12px;
  background: #f5f7f9;
  color: #475867;
  font-weight: 600;
  border-bottom: 1px solid #ebeff3;
  white-space: nowrap;
`

const ThActions = styled(Th)`
  width: 48px;
  text-align: center;
`

const Tr = styled.tr`
  cursor: pointer;

  &:hover td {
    background: #f8fbff;
  }
`

const Td = styled.td`
  padding: 12px;
  border-bottom: 1px solid #ebeff3;
  vertical-align: top;
`

const TdActions = styled(Td)`
  text-align: center;
  vertical-align: middle;
  width: 48px;
`

const SubjectText = styled.span`
  font-weight: 500;
  color: #183247;
`

const ExternalLinkButton = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  color: #2c5cc5;
  text-decoration: none;
  transition: background 0.15s ease;

  &:hover {
    background: #ebf0fb;
  }

  &:focus-visible {
    outline: 2px solid #2c5cc5;
    outline-offset: 1px;
  }
`

const Badge = styled.span<{ $color: string; $bg: string }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  color: ${({ $color }) => $color};
  background: ${({ $bg }) => $bg};
  white-space: nowrap;
`

const EmptyState = styled.div`
  padding: 48px 16px;
  text-align: center;
  color: #6f7c87;
`

const DialogOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(18, 52, 77, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 1000;
`

const DialogPanel = styled.div`
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 720px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const ConfirmPanel = styled(DialogPanel)`
  max-width: 480px;
`

const DialogHeader = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid #ebeff3;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
`

const DialogHeaderContent = styled.div`
  flex: 1;
  min-width: 0;
`

const DialogTitle = styled.h2`
  margin: 0 0 8px;
  font-size: 1.1rem;
  font-weight: 600;
  color: #183247;
  line-height: 1.4;
`

const DialogBadges = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const DialogCloseButton = styled.button`
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #475867;
  font-size: 1.5rem;
  line-height: 1;
  padding: 4px;
  cursor: pointer;
  border-radius: 4px;

  &:hover {
    background: #f5f7f9;
    color: #183247;
  }

  &:focus-visible {
    outline: 2px solid #2c5cc5;
    outline-offset: 1px;
  }
`

const DialogMeta = styled.dl`
  margin: 0;
  padding: 12px 20px;
  border-bottom: 1px solid #ebeff3;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 16px;
  flex-shrink: 0;
  font-size: 0.88rem;
`

const DialogMetaItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const DialogMetaLabel = styled.dt`
  margin: 0;
  font-weight: 600;
  color: #6f7c87;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
`

const DialogMetaValue = styled.dd`
  margin: 0;
  color: #183247;
`

const DialogBody = styled.div`
  padding: 16px 20px 20px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
`

const ConfirmBody = styled.div`
  padding: 16px 20px;
  color: #475867;
  line-height: 1.5;
  font-size: 0.95rem;
`

const ConfirmActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 20px;
`

const ConversationThread = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ConversationMessage = styled.article`
  border-left: 3px solid #cfd7df;
  padding-left: 12px;
`

const ConversationHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.85rem;
`

const ConversationAuthor = styled.strong`
  color: #183247;
`

const ConversationTimestamp = styled.span`
  color: #6f7c87;
`

const ConversationBody = styled.div`
  white-space: pre-wrap;
  color: #475867;
  line-height: 1.5;
`

const ConversationStatus = styled.div`
  padding: 24px 0;
  text-align: center;
  color: #6f7c87;
`

const ConversationError = styled.div`
  padding: 16px;
  border-radius: 6px;
  background: #fdecea;
  color: #b42318;
  border: 1px solid #f5c2c0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
`

interface ConfirmState {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel?: () => void
}

interface DownloadChoiceState {
  onThisPage: () => void
  onEntireRange: () => void
  onCancel: () => void
}

function ExternalLinkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function statusBadge(status: number) {
  switch (status) {
    case 2:
      return { label: STATUS_LABELS[2], color: '#1f4e79', bg: '#dbeafe' }
    case 3:
      return { label: STATUS_LABELS[3], color: '#8a6116', bg: '#fef3c7' }
    case 4:
      return { label: STATUS_LABELS[4], color: '#166534', bg: '#dcfce7' }
    case 5:
      return { label: STATUS_LABELS[5], color: '#475867', bg: '#e5e7eb' }
    default:
      return {
        label: STATUS_LABELS[status] ?? `Status ${status}`,
        color: '#475867',
        bg: '#eef2f6',
      }
  }
}

function priorityBadge(priority: number) {
  switch (priority) {
    case 1:
      return { label: PRIORITY_LABELS[1], color: '#475867', bg: '#eef2f6' }
    case 2:
      return { label: PRIORITY_LABELS[2], color: '#1f4e79', bg: '#dbeafe' }
    case 3:
      return { label: PRIORITY_LABELS[3], color: '#8a6116', bg: '#fef3c7' }
    case 4:
      return { label: PRIORITY_LABELS[4], color: '#991b1b', bg: '#fee2e2' }
    default:
      return {
        label: PRIORITY_LABELS[priority] ?? `Priority ${priority}`,
        color: '#475867',
        bg: '#eef2f6',
      }
  }
}

function progressMessage(progress: FetchProgress | null): string {
  if (!progress) return ''
  if (progress.message) return progress.message
  return 'Fetching…'
}

function scrollPanelIntoView(panel: HTMLElement): void {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
  panel.scrollIntoView({ behavior, block: 'start' })
}

function pageRangeLabel(currentPage: number, totalTickets: number): string {
  if (totalTickets === 0) return 'No tickets loaded'
  const start = (currentPage - 1) * UI_PAGE_SIZE + 1
  const end = Math.min(currentPage * UI_PAGE_SIZE, totalTickets)
  return `${start}–${end} of ${totalTickets}`
}

function buildTicketFetchFilters(
  from: string,
  to: string,
  tags: string[],
  keywords: string[],
): TicketFetchFilters {
  return {
    from,
    to,
    tags,
    keywords,
  }
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Continue',
  onConfirm,
  onCancel,
}: ConfirmState) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onCancel])

  return (
    <DialogOverlay onClick={() => onCancel?.()} role="presentation">
      <ConfirmPanel
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogHeaderContent>
            <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
          </DialogHeaderContent>
        </DialogHeader>
        <ConfirmBody>{message}</ConfirmBody>
        <ConfirmActions>
          {onCancel ? (
            <Button type="button" $variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="button" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </ConfirmActions>
      </ConfirmPanel>
    </DialogOverlay>
  )
}

function DownloadChoiceDialog({
  onThisPage,
  onEntireRange,
  onCancel,
}: DownloadChoiceState) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onCancel])

  return (
    <DialogOverlay onClick={onCancel} role="presentation">
      <ConfirmPanel
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-choice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogHeaderContent>
            <DialogTitle id="download-choice-title">Download tickets</DialogTitle>
          </DialogHeaderContent>
        </DialogHeader>
        <ConfirmBody>Which tickets should be included in the export?</ConfirmBody>
        <ConfirmActions>
          <Button type="button" $variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" $variant="secondary" onClick={onThisPage}>
            This page
          </Button>
          <Button type="button" onClick={onEntireRange}>
            Entire range
          </Button>
        </ConfirmActions>
      </ConfirmPanel>
    </DialogOverlay>
  )
}

function TicketDialog({
  ticket,
  conversations,
  conversationsLoading,
  conversationsError,
  userNames,
  onRetry,
  onClose,
}: {
  ticket: EnrichedTicket
  conversations: Conversation[] | null
  conversationsLoading: boolean
  conversationsError: string | null
  userNames: Map<number, string>
  onRetry: () => void
  onClose: () => void
}) {
  const status = statusBadge(ticket.status)
  const priority = priorityBadge(ticket.priority)
  const titleId = `ticket-dialog-title-${ticket.id}`

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <DialogOverlay onClick={onClose} role="presentation">
      <DialogPanel
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogHeaderContent>
            <DialogTitle id={titleId}>
              #{ticket.id} — {ticket.subject}
            </DialogTitle>
            <DialogBadges>
              <Badge $color={status.color} $bg={status.bg}>
                {status.label}
              </Badge>
              <Badge $color={priority.color} $bg={priority.bg}>
                {priority.label}
              </Badge>
            </DialogBadges>
          </DialogHeaderContent>
          <DialogCloseButton type="button" onClick={onClose} aria-label="Close dialog">
            ×
          </DialogCloseButton>
        </DialogHeader>

        <DialogMeta>
          <DialogMetaItem>
            <DialogMetaLabel>Requester</DialogMetaLabel>
            <DialogMetaValue>{ticket.requesterName}</DialogMetaValue>
          </DialogMetaItem>
          <DialogMetaItem>
            <DialogMetaLabel>Agent</DialogMetaLabel>
            <DialogMetaValue>{ticket.agentName}</DialogMetaValue>
          </DialogMetaItem>
          <DialogMetaItem>
            <DialogMetaLabel>Created</DialogMetaLabel>
            <DialogMetaValue>{formatUtcDateTime(ticket.created_at)}</DialogMetaValue>
          </DialogMetaItem>
          <DialogMetaItem>
            <DialogMetaLabel>Due</DialogMetaLabel>
            <DialogMetaValue>{formatUtcDateTime(ticket.due_by)}</DialogMetaValue>
          </DialogMetaItem>
        </DialogMeta>

        <DialogBody>
          {conversationsLoading ? (
            <ConversationStatus>Loading conversation…</ConversationStatus>
          ) : conversationsError ? (
            <ConversationError>
              <span>{conversationsError}</span>
              <Button type="button" onClick={onRetry}>Retry</Button>
            </ConversationError>
          ) : (
            <ConversationThread>
              <ConversationMessage>
                <ConversationHeader>
                  <ConversationAuthor>{ticket.requesterName}</ConversationAuthor>
                  <Badge $color="#1f4e79" $bg="#dbeafe">Opening message</Badge>
                  <ConversationTimestamp>
                    {formatUtcDateTime(ticket.created_at)}
                  </ConversationTimestamp>
                </ConversationHeader>
                <ConversationBody>
                  {getTicketDescription(ticket) || 'No description.'}
                </ConversationBody>
              </ConversationMessage>

              {(conversations ?? []).map((conversation) => {
                const typeLabel = getConversationTypeLabel(conversation)
                const isPrivate = conversation.private
                return (
                  <ConversationMessage key={conversation.id}>
                    <ConversationHeader>
                      <ConversationAuthor>
                        {getConversationAuthorName(conversation, ticket, userNames)}
                      </ConversationAuthor>
                      <Badge
                        $color={isPrivate ? '#8a6116' : '#1f4e79'}
                        $bg={isPrivate ? '#fef3c7' : '#dbeafe'}
                      >
                        {typeLabel}
                      </Badge>
                      <ConversationTimestamp>
                        {formatUtcDateTime(conversation.created_at)}
                      </ConversationTimestamp>
                    </ConversationHeader>
                    <ConversationBody>
                      {getConversationBody(conversation) || '(Empty message.)'}
                    </ConversationBody>
                  </ConversationMessage>
                )
              })}
            </ConversationThread>
          )}
        </DialogBody>
      </DialogPanel>
    </DialogOverlay>
  )
}

function App() {
  const defaults = defaultDateRange()
  const [fromDate, setFromDate] = useState(defaults.from)
  const [toDate, setToDate] = useState(defaults.to)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [keywords, setKeywords] = useState<string[]>([...DEFAULT_KEYWORDS])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)
  const [domain, setDomain] = useState('')
  const [tickets, setTickets] = useState<EnrichedTicket[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [totalTickets, setTotalTickets] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [userNames, setUserNames] = useState<Map<number, string>>(new Map())
  const [conversationsCache, setConversationsCache] = useState<Map<number, Conversation[]>>(
    new Map(),
  )
  const [search, setSearch] = useState('')
  const [selectedTicket, setSelectedTicket] = useState<EnrichedTicket | null>(null)
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<FetchProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [downloadChoice, setDownloadChoice] = useState<DownloadChoiceState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const conversationAbortRef = useRef<AbortController | null>(null)
  const conversationsCacheRef = useRef(conversationsCache)
  const panelRef = useRef<HTMLElement>(null)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const previousPageRef = useRef(currentPage)
  const cachesRef = useRef<TicketFetchCaches>(createTicketFetchCaches())
  const [loadingIndicatorTop, setLoadingIndicatorTop] = useState<number | null>(null)
  conversationsCacheRef.current = conversationsCache

  useEffect(() => {
    fetchAppConfig()
      .then((config) => setDomain(config.domain))
      .catch((err) => {
        const message =
          err instanceof FreshdeskApiError ? err.message : 'Failed to load configuration.'
        setError(message)
      })
  }, [])

  const loadAvailableTags = useCallback(() => {
    setTagsLoading(true)

    void fetchFreshdeskTags()
      .then((tags) => {
        setAvailableTags(tags)
        setTagsLoading(false)
      })
      .catch(() => {
        setAvailableTags([])
        setTagsLoading(false)
      })
  }, [])

  useEffect(() => {
    loadAvailableTags()
  }, [loadAvailableTags])

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return tickets
    return tickets.filter(
      (ticket) =>
        ticket.subject.toLowerCase().includes(query) ||
        ticket.requesterName.toLowerCase().includes(query) ||
        String(ticket.id).includes(query),
    )
  }, [search, tickets])

  const closeDialog = useCallback(() => {
    conversationAbortRef.current?.abort()
    setSelectedTicket(null)
    setConversationsLoading(false)
    setConversationsError(null)
  }, [])

  const loadConversations = useCallback(
    async (ticket: EnrichedTicket, force = false) => {
      if (!force && conversationsCacheRef.current.has(ticket.id)) {
        setConversationsLoading(false)
        setConversationsError(null)
        return
      }

      conversationAbortRef.current?.abort()
      const controller = new AbortController()
      conversationAbortRef.current = controller

      setConversationsLoading(true)
      setConversationsError(null)

      try {
        const conversations = await fetchTicketConversations(ticket.id, {
          signal: controller.signal,
        })
        setConversationsCache((previous) => {
          const next = new Map(previous)
          next.set(ticket.id, conversations)
          return next
        })
        setConversationsLoading(false)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const message =
          err instanceof FreshdeskApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to load conversation.'
        setConversationsError(message)
        setConversationsLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!selectedTicket) return
    void loadConversations(selectedTicket)
  }, [selectedTicket, loadConversations])

  const retryConversations = useCallback(() => {
    if (!selectedTicket) return
    setConversationsCache((previous) => {
      const next = new Map(previous)
      next.delete(selectedTicket.id)
      return next
    })
    void loadConversations(selectedTicket, true)
  }, [loadConversations, selectedTicket])

  const loadPage = useCallback(
    async (page: number) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const filters = buildTicketFetchFilters(fromDate, toDate, selectedTags, keywords)

      setLoading(true)
      setError(null)
      setExportSuccess(null)
      setProgress(null)
      setSelectedTicket(null)
      setConversationsLoading(false)
      setConversationsError(null)

      try {
        const result = await fetchTicketPage(
          filters,
          page,
          cachesRef.current,
          setProgress,
          { signal: controller.signal },
        )
        setTickets(result.tickets)
        setTotalTickets(result.total)
        setTotalPages(result.totalPages)
        setCurrentPage(page)
        setUserNames(result.userNames)
        setSearch('')
        setProgress(null)
        setHasFetched(true)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const message =
          err instanceof FreshdeskApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Unexpected error while fetching tickets.'
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [fromDate, keywords, selectedTags, toDate],
  )

  const startFetchAfterPreview = useCallback(
    async (
      filters: TicketFetchFilters,
      previewTotal: number,
      previewTotalPages: number,
    ) => {
      const hasKeywords = filters.keywords.length > 0

      if (previewTotal > WARN_TICKETS) {
        const message = hasKeywords
          ? `This range has ${previewTotal} tickets (${previewTotalPages} pages). Keywords require loading all ${previewTotalPages} pages before filtering. Continue?`
          : `This range has ${previewTotal} tickets (${previewTotalPages} pages). Only the first ${UI_PAGE_SIZE} will load now.`

        setConfirm({
          title: 'Large result set',
          message,
          onConfirm: () => {
            setConfirm(null)
            void loadPage(1)
          },
          onCancel: () => setConfirm(null),
        })
        return
      }

      await loadPage(1)
    },
    [loadPage],
  )

  const runFetchWithPreview = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const filters = buildTicketFetchFilters(fromDate, toDate, selectedTags, keywords)

    setLoading(true)
    setError(null)
    setExportSuccess(null)
    setProgress(null)
    setTickets([])
    setTotalTickets(0)
    setTotalPages(0)
    setCurrentPage(1)
    setUserNames(new Map())
    setConversationsCache(new Map())
    cachesRef.current = createTicketFetchCaches()
    setHasFetched(false)
    setSelectedTicket(null)
    setConversationsLoading(false)
    setConversationsError(null)

    try {
      const preview = await previewTicketSearch(filters, cachesRef.current, {
        signal: controller.signal,
      })
      setLoading(false)
      await startFetchAfterPreview(filters, preview.total, preview.totalPages)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const message =
        err instanceof FreshdeskApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unexpected error while fetching tickets.'
      setError(message)
      setLoading(false)
    }
  }, [fromDate, keywords, startFetchAfterPreview, selectedTags, toDate])

  const handleFetch = useCallback(() => {
    setError(null)
    setExportSuccess(null)

    const filters = buildTicketFetchFilters(fromDate, toDate, selectedTags, keywords)

    try {
      validateFetchFilters(filters)
    } catch (err) {
      const message =
        err instanceof FreshdeskApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Invalid fetch filters.'
      setError(message)
      return
    }

    const days = countInclusiveDays(fromDate, toDate)
    if (days > WARN_DATE_RANGE_DAYS) {
      setConfirm({
        title: 'Large date range',
        message: `This range is ${days} days. Large fetches can hit Freshdesk rate limits. Continue?`,
        onConfirm: () => {
          setConfirm(null)
          void runFetchWithPreview()
        },
        onCancel: () => setConfirm(null),
      })
      return
    }

    void runFetchWithPreview()
  }, [fromDate, keywords, runFetchWithPreview, selectedTags, toDate])

  const fetchConversationsForTickets = useCallback(
    async (
      ticketsToFetch: EnrichedTicket[],
      nextCache: Map<number, Conversation[]>,
    ) => {
      const missingTickets = ticketsToFetch.filter((ticket) => !nextCache.has(ticket.id))

      for (let index = 0; index < missingTickets.length; index += 1) {
        const ticket = missingTickets[index]
        setProgress({
          fetched: index + 1,
          total: missingTickets.length,
          page: index + 1,
          totalPages: missingTickets.length,
          phase: 'conversations',
          status: 'fetching',
          message: `Loading conversations ${index + 1}/${missingTickets.length}…`,
        })
        const conversations = await fetchTicketConversations(ticket.id)
        nextCache.set(ticket.id, conversations)
      }

      setConversationsCache(nextCache)
    },
    [],
  )

  const executeDownload = useCallback(
    async (scope: 'page' | 'range') => {
      if (!domain) return

      const filters = buildTicketFetchFilters(fromDate, toDate, selectedTags, keywords)
      const exportKeywords = filters.keywords

      setDownloading(true)
      setError(null)
      setExportSuccess(null)
      setProgress(null)

      let ticketsToExport = tickets
      let exportUserNames = userNames
      const nextCache = new Map(conversationsCache)

      try {
        if (scope === 'range') {
          const result = await fetchAllTicketsInRange(
            filters,
            cachesRef.current,
            setProgress,
          )
          ticketsToExport = result.tickets
          exportUserNames = result.userNames
          setUserNames(result.userNames)
        }

        const missingCount = ticketsToExport.filter((ticket) => !nextCache.has(ticket.id)).length

        const finishDownload = async () => {
          await fetchConversationsForTickets(ticketsToExport, nextCache)
          const prepared = prepareExportForDownload(
            ticketsToExport,
            nextCache,
            exportUserNames,
            exportKeywords,
          )
          const markdown =
            prepared.matchedCount === 0 && exportKeywords.length > 0
              ? buildNoMatchesMarkdown(
                  fromDate,
                  toDate,
                  prepared.totalCount,
                  exportKeywords,
                )
              : buildTicketsMarkdown(
                  prepared.tickets,
                  fromDate,
                  toDate,
                  domain,
                  prepared.conversationsByTicketId,
                  prepared.userNames,
                  exportKeywords,
                )
          const suffix = scope === 'page' ? `page-${currentPage}` : 'all'
          downloadMarkdown(markdown, `tickets-${fromDate}-to-${toDate}-${suffix}.md`)
          setExportSuccess(
            buildExportSuccessMessage(
              prepared.matchedCount,
              prepared.totalCount,
              exportKeywords,
            ),
          )
          setProgress(null)
        }

        if (missingCount > WARN_CONVERSATIONS_DOWNLOAD) {
          setDownloading(false)
          setConfirm({
            title: 'Large download',
            message: `Will request conversations for ${missingCount} tickets. This can take several minutes and uses a lot of API quota. Continue?`,
            onConfirm: () => {
              setConfirm(null)
              setDownloading(true)
              void finishDownload()
                .catch((err) => {
                  const message =
                    err instanceof FreshdeskApiError
                      ? err.message
                      : err instanceof Error
                        ? err.message
                        : 'Failed to download markdown.'
                  setError(message)
                })
                .finally(() => setDownloading(false))
            },
            onCancel: () => setConfirm(null),
          })
          return
        }

        await finishDownload()
      } catch (err) {
        const message =
          err instanceof FreshdeskApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to download markdown.'
        setError(message)
      } finally {
        setDownloading(false)
      }
    },
    [
      conversationsCache,
      currentPage,
      domain,
      fetchConversationsForTickets,
      fromDate,
      keywords,
      selectedTags,
      tickets,
      toDate,
      userNames,
    ],
  )

  const handleDownloadClick = useCallback(() => {
    if (!tickets.length || !domain) return

    setDownloadChoice({
      onThisPage: () => {
        setDownloadChoice(null)
        void executeDownload('page')
      },
      onEntireRange: () => {
        setDownloadChoice(null)
        void executeDownload('range')
      },
      onCancel: () => setDownloadChoice(null),
    })
  }, [domain, executeDownload, tickets.length])

  const statusTone = error ? 'error' : progress?.status === 'rate_limited' ? 'warn' : 'info'
  const statusText =
    error ??
    (loading || downloading ? progressMessage(progress) : exportSuccess)
  const isBusy = loading || downloading
  const downloadDisabledReason = downloading
    ? 'A download is already in progress.'
    : loading
      ? 'Wait until tickets finish fetching.'
      : tickets.length === 0
        ? 'No tickets to download. Fetch tickets first.'
        : undefined
  const tagsUnavailable = !tagsLoading && availableTags.length === 0
  const hasLoadedTickets = totalTickets > 0
  const showTableLoading = loading && !downloading && tickets.length > 0

  useLayoutEffect(() => {
    if (!showTableLoading) {
      setLoadingIndicatorTop(null)
      return
    }

    const wrap = tableWrapRef.current
    const tbody = tableBodyRef.current
    if (!wrap || !tbody) return

    const rows = tbody.querySelectorAll('tr')
    if (rows.length === 0) return

    const targetRow = rows[Math.min(2, rows.length - 1)] as HTMLTableRowElement
    const wrapRect = wrap.getBoundingClientRect()
    const rowRect = targetRow.getBoundingClientRect()
    setLoadingIndicatorTop(rowRect.top - wrapRect.top + rowRect.height / 2)
  }, [showTableLoading, filteredTickets])

  useLayoutEffect(() => {
    if (!showTableLoading) return
    const panel = panelRef.current
    if (!panel) return
    scrollPanelIntoView(panel)
  }, [showTableLoading])

  useLayoutEffect(() => {
    const previousPage = previousPageRef.current
    previousPageRef.current = currentPage

    if (previousPage === currentPage || totalTickets === 0) return

    const panel = panelRef.current
    if (!panel) return
    scrollPanelIntoView(panel)
  }, [currentPage, totalTickets])

  return (
    <GlobalStyle>
      <Header>
        <Title>Freshdesk Tickets Viewer</Title>
        {domain ? <DomainBadge>{domain}.freshdesk.com</DomainBadge> : null}
      </Header>

      <Main>
        <Toolbar>
          <Field>
            From
            <Input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              disabled={isBusy}
            />
          </Field>
          <Field>
            To
            <Input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              disabled={isBusy}
            />
          </Field>
          <Field>
            Tags
            <ChipSelect
              values={selectedTags}
              onChange={setSelectedTags}
              options={availableTags}
              allowCustom={false}
              placeholder={tagsUnavailable ? 'No tags found' : 'Select tags'}
              disabled={isBusy || tagsUnavailable}
              loading={tagsLoading}
            />
          </Field>
          <Field>
            Keywords
            <ChipSelect
              values={keywords}
              onChange={setKeywords}
              allowCustom
              placeholder="Type keyword and press Enter"
              disabled={isBusy}
            />
          </Field>
          <Button type="button" onClick={handleFetch} disabled={isBusy || !domain}>
            {loading ? 'Fetching…' : 'Fetch tickets'}
          </Button>
          <TooltipWrap>
            <Button
              type="button"
              $variant="secondary"
              onClick={handleDownloadClick}
              disabled={Boolean(downloadDisabledReason)}
              aria-describedby={
                downloadDisabledReason ? 'download-markdown-tooltip' : undefined
              }
            >
              {downloading ? 'Preparing download…' : 'Download tickets'}
            </Button>
            {downloadDisabledReason ? (
              <TooltipBubble id="download-markdown-tooltip" role="tooltip" data-tooltip-bubble>
                {downloadDisabledReason}
              </TooltipBubble>
            ) : null}
          </TooltipWrap>
        </Toolbar>

        {statusText ? <StatusBar $tone={statusTone}>{statusText}</StatusBar> : null}

        <Panel ref={panelRef}>
          <PanelHeader>
            <strong>
              {hasLoadedTickets
                ? pageRangeLabel(currentPage, totalTickets)
                : 'No tickets loaded'}
            </strong>
            {hasLoadedTickets ? (
              <SearchInput
                type="search"
                placeholder="Search this page"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            ) : null}
          </PanelHeader>

          {filteredTickets.length === 0 ? (
            <EmptyState>
              {loading
                ? 'Fetching tickets from Freshdesk…'
                : downloading
                  ? 'Loading conversations for markdown export…'
                  : !hasFetched
                    ? 'Choose a date range and click Fetch tickets.'
                    : 'No tickets matched the current filters.'}
            </EmptyState>
          ) : (
            <>
              <TableWrap ref={tableWrapRef} aria-busy={showTableLoading}>
                <TableContent $dimmed={showTableLoading}>
                  <Table>
                    <thead>
                      <tr>
                        <Th>#</Th>
                        <Th>Subject</Th>
                        <Th>Requester</Th>
                        <Th>Status</Th>
                        <Th>Priority</Th>
                        <Th>Agent</Th>
                        <Th>Created</Th>
                        <Th>Due</Th>
                        <ThActions aria-label="Open in Freshdesk" />
                      </tr>
                    </thead>
                    <tbody ref={tableBodyRef}>
                      {filteredTickets.map((ticket) => {
                        const status = statusBadge(ticket.status)
                        const priority = priorityBadge(ticket.priority)
                        const url = domain ? ticketUrl(domain, ticket.id) : '#'

                        return (
                          <Tr
                            key={ticket.id}
                            onClick={() => {
                              setSelectedTicket(ticket)
                              if (!conversationsCacheRef.current.has(ticket.id)) {
                                setConversationsLoading(true)
                                setConversationsError(null)
                              } else {
                                setConversationsLoading(false)
                                setConversationsError(null)
                              }
                            }}
                          >
                            <Td>#{ticket.id}</Td>
                            <Td>
                              <SubjectText>{ticket.subject}</SubjectText>
                            </Td>
                            <Td>{ticket.requesterName}</Td>
                            <Td>
                              <Badge $color={status.color} $bg={status.bg}>
                                {status.label}
                              </Badge>
                            </Td>
                            <Td>
                              <Badge $color={priority.color} $bg={priority.bg}>
                                {priority.label}
                              </Badge>
                            </Td>
                            <Td>{ticket.agentName}</Td>
                            <Td>{formatUtcDateTime(ticket.created_at)}</Td>
                            <Td>{formatUtcDateTime(ticket.due_by)}</Td>
                            <TdActions>
                              <ExternalLinkButton
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ticket #${ticket.id} in Freshdesk`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <ExternalLinkIcon />
                              </ExternalLinkButton>
                            </TdActions>
                          </Tr>
                        )
                      })}
                    </tbody>
                  </Table>
                </TableContent>
                {showTableLoading ? (
                  <>
                    <TableLoadingOverlay />
                    {loadingIndicatorTop !== null ? (
                      <TableLoadingIndicator
                        $top={loadingIndicatorTop}
                        role="status"
                        aria-live="polite"
                      >
                        <TableSpinner aria-hidden="true" />
                        <TableLoadingText>
                          {progressMessage(progress) || 'Loading page…'}
                        </TableLoadingText>
                      </TableLoadingIndicator>
                    ) : null}
                  </>
                ) : null}
              </TableWrap>

              {totalPages > 1 ? (
                <Pager>
                  <Button
                    type="button"
                    $variant="secondary"
                    disabled={isBusy || currentPage <= 1}
                    onClick={() => void loadPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <PagerText>
                    Page {currentPage} of {totalPages}
                  </PagerText>
                  <Button
                    type="button"
                    $variant="secondary"
                    disabled={isBusy || currentPage >= totalPages}
                    onClick={() => void loadPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </Pager>
              ) : null}
            </>
          )}
        </Panel>
      </Main>

      {selectedTicket ? (
        <TicketDialog
          ticket={selectedTicket}
          conversations={conversationsCache.get(selectedTicket.id) ?? null}
          conversationsLoading={conversationsLoading}
          conversationsError={conversationsError}
          userNames={userNames}
          onRetry={retryConversations}
          onClose={closeDialog}
        />
      ) : null}

      {confirm ? <ConfirmDialog {...confirm} /> : null}
      {downloadChoice ? <DownloadChoiceDialog {...downloadChoice} /> : null}
    </GlobalStyle>
  )
}

export default App
