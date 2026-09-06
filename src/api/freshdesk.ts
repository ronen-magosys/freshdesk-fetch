import {
  type Agent,
  type Contact,
  type Conversation,
  type EnrichedTicket,
  FreshdeskApiError,
  type FetchProgress,
  type SearchTicketsResponse,
  type Ticket,
} from './types'

export const UI_PAGE_SIZE = 30
export const MAX_SEARCH_PAGES = 10
export const MAX_TICKETS_PER_FETCH = MAX_SEARCH_PAGES * UI_PAGE_SIZE
export const MAX_DATE_RANGE_DAYS = 31
export const WARN_DATE_RANGE_DAYS = 14
export const WARN_TICKETS = 100
export const WARN_CONVERSATIONS_DOWNLOAD = 50

const STATUS_LABELS: Record<number, string> = {
  2: 'Open',
  3: 'Pending',
  4: 'Resolved',
  5: 'Closed',
  6: 'Waiting on Customer',
  7: 'Waiting on Third Party',
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
}

export { STATUS_LABELS, PRIORITY_LABELS }

export interface TicketFetchCaches {
  agents: Map<number, string> | null
  contacts: Map<number, string>
  searchPages: Map<number, Ticket[]>
  searchTotal: number | null
}

export function createTicketFetchCaches(): TicketFetchCaches {
  return {
    agents: null,
    contacts: new Map(),
    searchPages: new Map(),
    searchTotal: null,
  }
}

export interface SearchTicketsPreview {
  total: number
  totalPages: number
}

export interface FetchTicketPageResult {
  tickets: EnrichedTicket[]
  total: number
  totalPages: number
  userNames: Map<number, string>
}

export interface FetchAllTicketsResult {
  tickets: EnrichedTicket[]
  userNames: Map<number, string>
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get('Retry-After')
  if (!value) return undefined
  const seconds = Number.parseInt(value, 10)
  return Number.isFinite(seconds) ? seconds : undefined
}

function parseRateLimitRemaining(headers: Headers): number | undefined {
  const value =
    headers.get('X-RateLimit-Remaining') ?? headers.get('x-ratelimit-remaining')
  if (!value) return undefined
  const remaining = Number.parseFloat(value)
  return Number.isFinite(remaining) ? remaining : undefined
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      description?: string
      message?: string
      errors?: Array<{ message?: string; field?: string }>
    }
    if (body.description) return body.description
    if (body.message) return body.message
    if (body.errors?.length) {
      return body.errors.map((e) => e.message ?? e.field ?? 'Unknown error').join('; ')
    }
  } catch {
    // ignore JSON parse errors
  }
  return response.statusText || `HTTP ${response.status}`
}

function mapHttpError(status: number, message: string, retryAfter?: number): FreshdeskApiError {
  switch (status) {
    case 401:
      return new FreshdeskApiError('Check FRESHDESK_API_KEY in `.env`.', status)
    case 403:
      return new FreshdeskApiError(
        'Access denied — your API key may lack permission for this endpoint.',
        status,
      )
    case 404:
      return new FreshdeskApiError('Check FRESHDESK_DOMAIN in `.env`.', status)
    case 400:
      return new FreshdeskApiError(message, status)
    case 429:
      return new FreshdeskApiError('Rate limit exceeded.', status, {
        retryAfterSeconds: retryAfter ?? 30,
        recoverable: true,
      })
    default:
      if (status >= 500) {
        return new FreshdeskApiError(message || 'Freshdesk server error.', status, {
          recoverable: true,
        })
      }
      return new FreshdeskApiError(message || `Request failed (${status}).`, status)
  }
}

export interface FreshdeskFetchOptions {
  signal?: AbortSignal
  onRateLimitWait?: (seconds: number) => void
  skip404?: boolean
}

export async function freshdeskFetch<T>(
  path: string,
  options: FreshdeskFetchOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const max429Retries = 5
  const max5xxRetries = 3
  let attempt429 = 0
  let attempt5xx = 0

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    let response: Response
    try {
      response = await fetch(path, { signal: options.signal })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new FreshdeskApiError(
        'Could not reach Freshdesk proxy — is `npm run dev` running?',
        0,
      )
    }

    if (response.ok) {
      const remaining = parseRateLimitRemaining(response.headers)
      if (remaining === 0) {
        const wait = parseRetryAfter(response.headers) ?? 1
        options.onRateLimitWait?.(wait)
        await sleep(wait * 1000, options.signal)
      }

      if (response.status === 204) {
        return { data: undefined as T, headers: response.headers }
      }

      const data = (await response.json()) as T
      return { data, headers: response.headers }
    }

    const retryAfter = parseRetryAfter(response.headers)
    const message = await parseErrorMessage(response)

    if (response.status === 404 && options.skip404) {
      throw new FreshdeskApiError(message, 404)
    }

    if (response.status === 429 && attempt429 < max429Retries) {
      attempt429 += 1
      const wait = retryAfter ?? 30
      options.onRateLimitWait?.(wait)
      await sleep(wait * 1000, options.signal)
      continue
    }

    if (response.status >= 500 && attempt5xx < max5xxRetries) {
      attempt5xx += 1
      const backoff = 1000 * 2 ** (attempt5xx - 1)
      await sleep(backoff, options.signal)
      continue
    }

    throw mapHttpError(response.status, message, retryAfter)
  }
}

function formatDateForQuery(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function dayBefore(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return formatDateForQuery(date)
}

function buildCreatedAtQuery(from: string, to: string): string {
  const fromExclusive = dayBefore(from)
  return `"created_at:>'${fromExclusive}' AND created_at:<'${to}'"`
}

function compareDates(a: string, b: string): number {
  return a.localeCompare(b)
}

export function countInclusiveDays(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00Z`)
  const toDate = new Date(`${to}T00:00:00Z`)
  const diffMs = toDate.getTime() - fromDate.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1
}

export function validateDateRange(from: string, to: string): void {
  if (compareDates(from, to) > 0) {
    throw new FreshdeskApiError('"From" date must be on or before "To" date.', 400)
  }

  const days = countInclusiveDays(from, to)
  if (days > MAX_DATE_RANGE_DAYS) {
    throw new FreshdeskApiError(
      `Date range is ${days} days. Maximum allowed is ${MAX_DATE_RANGE_DAYS} days. Narrow the range.`,
      400,
    )
  }
}

export function computeTotalPages(total: number): number {
  return Math.min(Math.max(Math.ceil(total / UI_PAGE_SIZE), 1), MAX_SEARCH_PAGES)
}

function assertTicketTotalWithinLimit(total: number): void {
  if (total > MAX_TICKETS_PER_FETCH) {
    throw new FreshdeskApiError(
      `This range has ${total} tickets; max is ${MAX_TICKETS_PER_FETCH}. Narrow the dates.`,
      400,
    )
  }
}

async function searchTicketsPage(
  from: string,
  to: string,
  page: number,
  options: FreshdeskFetchOptions,
): Promise<SearchTicketsResponse> {
  const query = encodeURIComponent(buildCreatedAtQuery(from, to))
  const { data } = await freshdeskFetch<SearchTicketsResponse>(
    `/api/v2/search/tickets?query=${query}&page=${page}`,
    options,
  )
  return data
}

async function getSearchPageTickets(
  from: string,
  to: string,
  page: number,
  caches: TicketFetchCaches,
  options: FreshdeskFetchOptions,
): Promise<Ticket[]> {
  const cached = caches.searchPages.get(page)
  if (cached) return cached

  const pageData = await searchTicketsPage(from, to, page, options)
  caches.searchPages.set(page, pageData.results)
  return pageData.results
}

async function fetchAllAgents(options: FreshdeskFetchOptions): Promise<Map<number, string>> {
  const agents = new Map<number, string>()
  let page = 1
  let hasMore = true

  while (hasMore) {
    const { data } = await freshdeskFetch<Agent[]>(
      `/api/v2/agents?page=${page}&per_page=100`,
      options,
    )
    if (!Array.isArray(data) || data.length === 0) break
    for (const agent of data) {
      agents.set(agent.id, agent.contact?.name ?? `Agent #${agent.id}`)
    }
    hasMore = data.length === 100
    page += 1
  }

  return agents
}

async function fetchContactName(
  contactId: number,
  options: FreshdeskFetchOptions,
): Promise<string> {
  try {
    const { data } = await freshdeskFetch<Contact>(
      `/api/v2/contacts/${contactId}`,
      { ...options, skip404: true },
    )
    return data.name || data.email || `#${contactId}`
  } catch (error) {
    if (error instanceof FreshdeskApiError && error.status === 404) {
      return `#${contactId}`
    }
    throw error
  }
}

function createProgressReporter(
  onProgress: (progress: FetchProgress) => void,
  options: FreshdeskFetchOptions,
): {
  fetchOptions: FreshdeskFetchOptions
  report: (progress: FetchProgress) => void
} {
  let lastProgress: FetchProgress | null = null

  const report = (progress: FetchProgress) => {
    lastProgress = progress
    onProgress(progress)
  }

  const fetchOptions: FreshdeskFetchOptions = {
    ...options,
    onRateLimitWait: (seconds) => {
      if (lastProgress) {
        report({
          ...lastProgress,
          status: 'rate_limited',
          retryAfterSeconds: seconds,
          message: `${lastProgress.message ?? 'Working…'} — rate limited, retrying in ${seconds}s`,
        })
      } else {
        report({
          fetched: 0,
          total: 0,
          page: 0,
          totalPages: 0,
          phase: 'tickets',
          status: 'rate_limited',
          retryAfterSeconds: seconds,
          message: `Rate limited — retrying in ${seconds}s`,
        })
      }
      options.onRateLimitWait?.(seconds)
    },
  }

  return { fetchOptions, report }
}

async function ensureAgents(
  caches: TicketFetchCaches,
  options: FreshdeskFetchOptions,
  onProgress?: (progress: FetchProgress) => void,
): Promise<Map<number, string>> {
  if (caches.agents) return caches.agents

  onProgress?.({
    fetched: 0,
    total: 0,
    page: 0,
    totalPages: 0,
    phase: 'agents',
    status: 'fetching',
    message: 'Loading agents…',
  })

  caches.agents = await fetchAllAgents(options)
  return caches.agents
}

async function enrichTickets(
  rawTickets: Ticket[],
  caches: TicketFetchCaches,
  options: FreshdeskFetchOptions,
  onProgress: (progress: FetchProgress) => void,
  pageContext: { page: number; totalPages: number; total: number },
): Promise<{ tickets: EnrichedTicket[]; userNames: Map<number, string> }> {
  const agents = await ensureAgents(caches, options)
  const requesterIds = [...new Set(rawTickets.map((ticket) => ticket.requester_id))]
  const missingRequesterIds = requesterIds.filter((id) => !caches.contacts.has(id))

  for (let index = 0; index < missingRequesterIds.length; index += 1) {
    const id = missingRequesterIds[index]
    onProgress({
      fetched: index + 1,
      total: missingRequesterIds.length,
      page: pageContext.page,
      totalPages: pageContext.totalPages,
      phase: 'contacts',
      status: 'fetching',
      message: `Loading requester names ${index + 1}/${missingRequesterIds.length} (page ${pageContext.page}/${pageContext.totalPages})…`,
    })
    const name = await fetchContactName(id, options)
    caches.contacts.set(id, name)
  }

  const userNames = new Map<number, string>()
  for (const [id, name] of agents) {
    userNames.set(id, name)
  }
  for (const [id, name] of caches.contacts) {
    userNames.set(id, name)
  }

  const tickets = rawTickets.map((ticket) => ({
    ...ticket,
    requesterName: caches.contacts.get(ticket.requester_id) ?? `#${ticket.requester_id}`,
    agentName: ticket.responder_id
      ? (agents.get(ticket.responder_id) ?? `#${ticket.responder_id}`)
      : 'Unassigned',
  }))

  return { tickets, userNames }
}

export async function previewTicketSearch(
  from: string,
  to: string,
  caches: TicketFetchCaches,
  options: FreshdeskFetchOptions = {},
): Promise<SearchTicketsPreview> {
  validateDateRange(from, to)

  if (caches.searchTotal !== null) {
    return {
      total: caches.searchTotal,
      totalPages: computeTotalPages(caches.searchTotal),
    }
  }

  const firstPage = await searchTicketsPage(from, to, 1, options)
  assertTicketTotalWithinLimit(firstPage.total)
  caches.searchTotal = firstPage.total
  caches.searchPages.set(1, firstPage.results)
  return {
    total: firstPage.total,
    totalPages: computeTotalPages(firstPage.total),
  }
}

export async function fetchTicketPage(
  from: string,
  to: string,
  page: number,
  caches: TicketFetchCaches,
  onProgress: (progress: FetchProgress) => void,
  options: FreshdeskFetchOptions = {},
): Promise<FetchTicketPageResult> {
  validateDateRange(from, to)

  const { fetchOptions, report } = createProgressReporter(onProgress, options)

  let total: number
  let totalPages: number

  if (caches.searchTotal !== null) {
    total = caches.searchTotal
    totalPages = computeTotalPages(total)
  } else {
    const firstPage = await searchTicketsPage(from, to, 1, fetchOptions)
    assertTicketTotalWithinLimit(firstPage.total)
    total = firstPage.total
    totalPages = computeTotalPages(total)
    caches.searchTotal = total
    caches.searchPages.set(1, firstPage.results)
  }

  if (page < 1 || page > totalPages) {
    throw new FreshdeskApiError(
      `Page ${page} is out of range (1–${totalPages}).`,
      400,
    )
  }

  report({
    fetched: 0,
    total,
    page,
    totalPages,
    phase: 'tickets',
    status: 'fetching',
    message: `Loading page ${page} of ${totalPages}…`,
  })

  const rawTickets = await getSearchPageTickets(from, to, page, caches, fetchOptions)
  const { tickets, userNames } = await enrichTickets(
    rawTickets,
    caches,
    fetchOptions,
    report,
    { page, totalPages, total },
  )

  return { tickets, total, totalPages, userNames }
}

export async function fetchAllTicketsInRange(
  from: string,
  to: string,
  caches: TicketFetchCaches,
  onProgress: (progress: FetchProgress) => void,
  options: FreshdeskFetchOptions = {},
): Promise<FetchAllTicketsResult> {
  validateDateRange(from, to)

  const { fetchOptions, report } = createProgressReporter(onProgress, options)
  const preview = await previewTicketSearch(from, to, caches, fetchOptions)
  const { total, totalPages } = preview

  const allRawTickets: Ticket[] = []

  for (let page = 1; page <= totalPages; page += 1) {
    report({
      fetched: allRawTickets.length,
      total,
      page,
      totalPages,
      phase: 'tickets',
      status: 'fetching',
      message: `Loading page ${page} of ${totalPages}…`,
    })
    const pageTickets = await getSearchPageTickets(from, to, page, caches, fetchOptions)
    allRawTickets.push(...pageTickets)
  }

  const { tickets, userNames } = await enrichTickets(
    allRawTickets,
    caches,
    fetchOptions,
    report,
    { page: totalPages, totalPages, total },
  )

  return { tickets, userNames }
}

export async function fetchAppConfig(): Promise<{ domain: string }> {
  try {
    const response = await fetch('/api/config')
    if (!response.ok) {
      throw new FreshdeskApiError('Could not load Freshdesk domain config.', response.status)
    }
    return (await response.json()) as { domain: string }
  } catch (error) {
    if (error instanceof FreshdeskApiError) throw error
    throw new FreshdeskApiError(
      'Could not reach Freshdesk proxy — is `npm run dev` running?',
      0,
    )
  }
}

export async function fetchTicketConversations(
  ticketId: number,
  options: FreshdeskFetchOptions = {},
): Promise<Conversation[]> {
  const conversations: Conversation[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const { data } = await freshdeskFetch<Conversation[]>(
      `/api/v2/tickets/${ticketId}/conversations?page=${page}&per_page=100`,
      options,
    )
    if (!Array.isArray(data) || data.length === 0) break
    conversations.push(...data)
    hasMore = data.length === 100
    page += 1
  }

  return conversations
}

export function getConversationBody(conversation: Conversation): string {
  if (conversation.body_text?.trim()) return conversation.body_text.trim()
  return stripHtml(conversation.body)
}

export function getConversationAuthorName(
  conversation: Conversation,
  ticket: EnrichedTicket,
  userNames: Map<number, string>,
): string {
  if (conversation.incoming) return ticket.requesterName
  return userNames.get(conversation.user_id) ?? `#${conversation.user_id}`
}

export function getConversationTypeLabel(conversation: Conversation): string {
  if (conversation.private) return 'Private note'
  return 'Reply'
}

export function stripHtml(html: string | undefined): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent?.trim() ?? ''
}

export function getTicketDescription(ticket: Ticket): string {
  if (ticket.description_text?.trim()) return ticket.description_text.trim()
  return stripHtml(ticket.description)
}

export function formatUtcDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

export function ticketUrl(domain: string, ticketId: number): string {
  const normalized = domain.replace(/^https?:\/\//, '').replace(/\.freshdesk\.com.*$/, '')
  return `https://${normalized}.freshdesk.com/a/tickets/${ticketId}`
}

export function defaultDateRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setUTCDate(from.getUTCDate() - 7)
  return {
    from: formatDateForQuery(from),
    to: formatDateForQuery(to),
  }
}
