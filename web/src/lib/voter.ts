// Feature votes are anonymous: the browser makes up a random ID once and keeps it in localStorage.
// It isn't a cookie and it's only sent when you vote, so the server can keep one vote per browser.

const VOTER_KEY = 'offcut:voter-id'
const VOTES_KEY = 'offcut:votes'
const VOTED_AT_KEY = 'offcut:voted-at'
// Matches the API's `max-age=60` on GET /api/features.
const LIST_CACHE_MS = 60_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Private windows and blocked storage still get a working ID for as long as the page is open.
let memoryVoterId = ''

function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // randomUUID needs a secure context; this builds the same v4 layout by hand.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getVoterId(): string {
  try {
    const saved = localStorage.getItem(VOTER_KEY)
    if (saved && UUID_V4.test(saved)) return saved
  } catch {
    // Storage blocked: fall through to the in-memory ID.
  }
  memoryVoterId ||= newUuid()
  try {
    localStorage.setItem(VOTER_KEY, memoryVoterId)
  } catch {
    // Same as above.
  }
  return memoryVoterId
}

// The API doesn't say which features you voted for (that would need an account), so the browser remembers.
export function readVotes(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VOTES_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveVotes(votes: Set<string>): void {
  try {
    localStorage.setItem(VOTES_KEY, JSON.stringify([...votes]))
    localStorage.setItem(VOTED_AT_KEY, String(Date.now()))
  } catch {
    // Votes still count on the server; the page just won't remember them next visit.
  }
}

// The browser keeps the feature list for a minute, so straight after a vote that copy shows old counts.
export function votedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(VOTED_AT_KEY) ?? 0) < LIST_CACHE_MS
  } catch {
    return false
  }
}
