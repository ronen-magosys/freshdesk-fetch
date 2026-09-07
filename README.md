# Freshdesk Tickets Viewer

A local React app for searching Freshdesk tickets by date range and exporting sanitized markdown. Use it to review support conversations, filter by tags/status/keywords, and download ticket threads with PII redacted.

## Setup

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Set your Freshdesk credentials in `.env`:

   | Variable | Description |
   | --- | --- |
   | `FRESHDESK_DOMAIN` | Subdomain only (`yourcompany`) or full host (`yourcompany.freshdesk.com`) |
   | `FRESHDESK_API_KEY` | Freshdesk API key with ticket read access |

3. Install dependencies and start the dev server:

   ```bash
   npm install
   npm run dev
   ```

   Open the URL shown in the terminal (typically `http://localhost:5173`).

The API key is injected by the Vite dev proxy and is never sent to the browser. The UI only receives your Freshdesk domain via `/api/config`.

## Usage

1. **Choose a date range** — defaults to the last 7 days. Tickets are filtered by **created date**.
2. **Click Fetch tickets** — loads matching tickets from Freshdesk.
3. **Open Filters** (filter icon) to refine results:
   - **Status** — defaults to Closed; supports Open, Pending, Resolved, Closed, Waiting on Customer, Waiting on Third Party
   - **Tags** — loaded from your Freshdesk ticket fields
   - **Keywords** — defaults to `sdk`, `api`, `integration`; matches whole words in subject and description
4. **Browse the table** — 30 tickets per page with requester, agent, status, priority, created, and due dates. Use the search box to filter the current page locally.
5. **Click a row** — opens a dialog with the full conversation thread (opening message, replies, and private notes).
6. **Open in Freshdesk** — use the external-link icon on a row to open the ticket in Freshdesk.
7. **Download** (download icon) — export markdown with conversations. Choose:
   - **This page** — tickets currently shown
   - **Entire range** — all tickets matching the fetch filters

Exported markdown includes ticket metadata, conversation threads, and links back to Freshdesk. Sensitive data is redacted before download (emails, phone numbers, IP addresses, secrets/tokens, names, and remote-access credentials).

## Limits and notes

| Limit | Value |
| --- | --- |
| Maximum date range | 31 days |
| Maximum tickets per fetch | 300 (Freshdesk search API cap) |
| Page size | 30 tickets |

The app warns before:

- Fetching a range longer than **14 days**
- Loading large result sets (especially when keywords require downloading all pages first)
- Downloading conversations for more than **50 tickets**

**Keyword matching:** When fetching, keywords match ticket subject and description. On export, keywords also match conversation bodies; tickets with no matching content are excluded from the export.

**Rate limits:** The app retries automatically on Freshdesk rate limits (429) and server errors (5xx), with progress shown in the status bar.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start dev server with Freshdesk proxy |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run Oxlint |
