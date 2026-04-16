export interface ShowLogEntry {
  time: string       // ISO timestamp
  event: string      // category: transport, cue, device, signal
  detail: string     // human-readable description
}

const MAX_ENTRIES = 5000
let entries: ShowLogEntry[] = []
let listeners: Array<() => void> = []

function now(): string {
  return new Date().toISOString()
}

export const showLog = {
  log(event: string, detail: string): void {
    entries.push({ time: now(), event, detail })
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
    listeners.forEach(fn => fn())
  },

  getEntries(): ShowLogEntry[] {
    return entries.slice()
  },

  clear(): void {
    entries = []
    listeners.forEach(fn => fn())
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn)
    return () => { listeners = listeners.filter(l => l !== fn) }
  },

  toCsv(): string {
    const header = 'Time,Event,Detail'
    const rows = entries.map(e => {
      const escape = (s: string): string =>
        s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      return `${e.time},${escape(e.event)},${escape(e.detail)}`
    })
    return [header, ...rows].join('\r\n')
  }
}
