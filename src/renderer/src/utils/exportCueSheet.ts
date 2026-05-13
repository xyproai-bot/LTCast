import { SetlistItem, WaveformMarker, MARKER_TYPE_COLORS, MarkerType } from '../store'

export type CueSheetLayout = 'compact' | 'detailed'

interface CueSheetOptions {
  presetName: string
  setlist: SetlistItem[]
  markers: Record<string, WaveformMarker[]>
  fps: number
  layout?: CueSheetLayout
  durations?: Record<string, number | null>
  markerTypeColorOverrides?: Partial<Record<MarkerType, string>>
  appVersion?: string
  generatorStartTC?: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

function markerBadge(m: WaveformMarker, markerTypeColorOverrides: Partial<Record<MarkerType, string>>): string {
  const mType = m.type ?? 'custom'
  const color = m.color ?? markerTypeColorOverrides[mType] ?? MARKER_TYPE_COLORS[mType]
  const typeLabel = mType.toUpperCase().replace('-', ' ')
  return `<span class="type-badge" style="background:${color}">${typeLabel}</span>`
}

/**
 * Generate HTML cue sheet and use Electron's printToPDF for CJK-safe PDF output.
 * Returns the HTML string; caller passes it to main process via IPC.
 */
export function buildCueSheetHtml(options: CueSheetOptions): string {
  const {
    presetName,
    setlist,
    markers,
    fps,
    layout = 'detailed',
    durations = {},
    markerTypeColorOverrides = {},
    appVersion = '',
    generatorStartTC = ''
  } = options

  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const dateTime = `${date} ${time}`

  // Compute totals for title page
  let totalDurationSec = 0
  for (const item of setlist) {
    const dur = durations[item.path]
    if (dur != null) totalDurationSec += dur
  }
  const totalDurStr = totalDurationSec > 0 ? formatDuration(totalDurationSec) : '—'

  // ── Title page ────────────────────────────────────────────────────────
  let titlePage = `
    <div class="title-page">
      <div class="title-page-name">${esc(presetName || 'Untitled')}</div>
      <div class="title-page-subtitle">LTCast Cue Sheet</div>
      <div class="title-meta-grid">
        <div class="title-meta-item"><div class="title-meta-label">Generated</div><div class="title-meta-val">${dateTime}</div></div>
        <div class="title-meta-item"><div class="title-meta-label">Songs</div><div class="title-meta-val">${setlist.length}</div></div>
        <div class="title-meta-item"><div class="title-meta-label">Total Duration</div><div class="title-meta-val">${totalDurStr}</div></div>
        <div class="title-meta-item"><div class="title-meta-label">Frame Rate</div><div class="title-meta-val">${fps} fps</div></div>
        ${generatorStartTC ? `<div class="title-meta-item"><div class="title-meta-label">Start TC</div><div class="title-meta-val mono">${esc(generatorStartTC)}</div></div>` : ''}
        ${appVersion ? `<div class="title-meta-item"><div class="title-meta-label">LTCast</div><div class="title-meta-val">v${esc(appVersion)}</div></div>` : ''}
      </div>
    </div>`

  // ── Setlist body ────────────────────────────────────────────────────────
  let body = ''

  if (layout === 'compact') {
    // Compact: one row per song + inline marker count
    body += `<div class="section-page"><div class="section-page-title">Setlist</div>`
    body += `<table class="compact-table">
      <thead><tr>
        <th>#</th><th>Song</th><th>Duration</th><th>Markers</th><th>MIDI Cues</th><th>Notes</th>
      </tr></thead><tbody>`
    for (let i = 0; i < setlist.length; i++) {
      const song = setlist[i]
      const songMarkers = [...(markers[song.id] ?? [])].sort((a, b) => a.time - b.time)
      const songCues = (song.midiCues ?? []).filter(c => c.enabled)
      const dur = durations[song.path]
      const durStr = dur != null ? formatDuration(dur) : '—'

      body += `<tr>
        <td class="mono">${i + 1}</td>
        <td><strong>${esc(song.name)}</strong></td>
        <td class="mono">${durStr}</td>
        <td>${songMarkers.length}</td>
        <td>${songCues.length}</td>
        <td class="notes-cell">${song.notes ? esc(song.notes) : ''}</td>
      </tr>`

      // Compact sub-rows: markers inline
      if (songMarkers.length > 0) {
        body += `<tr class="compact-sub-row"><td></td><td colspan="5">`
        for (const m of songMarkers) {
          body += `<span class="compact-marker">${markerBadge(m, markerTypeColorOverrides)} <span class="mono">${formatTime(m.time)}</span> ${esc(m.label || '')}</span>`
        }
        body += `</td></tr>`
      }
    }
    body += `</tbody></table></div>`
  } else {
    // Detailed: one section per song, page-break before each
    for (let i = 0; i < setlist.length; i++) {
      const song = setlist[i]
      const songMarkers = [...(markers[song.id] ?? [])].sort((a, b) => a.time - b.time)
      const songCues = (song.midiCues ?? []).filter(c => c.enabled)
      const dur = durations[song.path]
      const durStr = dur != null ? formatDuration(dur) : '—'

      body += `<div class="song-section">`

      // Song header
      body += `<div class="song-header">
        <div class="song-header-left">
          <span class="song-number">${i + 1}</span>
          <span class="song-title">${esc(song.name)}</span>
        </div>
        <div class="song-header-right">
          <span class="song-meta-chip">${durStr}</span>
          <span class="song-meta-chip mono">${fps} fps</span>
        </div>
      </div>`

      // Notes
      if (song.notes) {
        body += `<div class="song-notes"><strong>Notes:</strong> ${esc(song.notes)}</div>`
      }

      // Markers table
      if (songMarkers.length > 0) {
        body += `<div class="section-label">Markers</div>`
        body += `<table class="data-table">
          <thead><tr><th>Time</th><th>Type</th><th>Label</th></tr></thead>
          <tbody>`
        for (const m of songMarkers) {
          body += `<tr>
            <td class="mono time-cell">${formatTime(m.time)}</td>
            <td>${markerBadge(m, markerTypeColorOverrides)}</td>
            <td>${esc(m.label || '')}</td>
          </tr>`
        }
        body += `</tbody></table>`
      } else {
        body += `<div class="empty-notice">No markers</div>`
      }

      // MIDI Cue list
      if (songCues.length > 0) {
        body += `<div class="section-label">MIDI Cues</div>`
        body += `<table class="data-table">
          <thead><tr><th>Timecode</th><th>Type</th><th>Channel</th><th>Data</th><th>Label</th></tr></thead>
          <tbody>`
        for (const cue of songCues) {
          const msgType = cue.messageType === 'program-change' ? 'PC'
            : cue.messageType === 'note-on' ? 'NOTE' : 'CC'
          const dataStr = cue.data2 !== undefined ? `${cue.data1} / ${cue.data2}` : String(cue.data1)
          body += `<tr>
            <td class="mono">${esc(cue.triggerTimecode)}</td>
            <td><span class="midi-badge">${msgType}</span></td>
            <td class="mono">${cue.channel}</td>
            <td class="mono">${dataStr}</td>
            <td>${esc(cue.label || '')}</td>
          </tr>`
        }
        body += `</tbody></table>`
      }

      body += `</div>` // song-section
    }
  }

  // ── CSS ────────────────────────────────────────────────────────────────
  const css = `
    @page {
      margin: 18mm 15mm 20mm 15mm;
      @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 8px;
        color: #aaa;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, 'Segoe UI', 'Yu Gothic', 'Hiragino Sans',
                   'Microsoft JhengHei', 'PingFang TC', sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      background: #fff;
    }

    /* Title page */
    .title-page {
      page-break-after: always;
      padding: 40px 0 20px;
      border-bottom: 3px solid #111;
      margin-bottom: 24px;
    }
    .title-page-name {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }
    .title-page-subtitle {
      font-size: 13px;
      color: #777;
      margin-bottom: 24px;
    }
    .title-meta-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .title-meta-item {
      background: #f5f5f5;
      border-radius: 6px;
      padding: 8px 14px;
      min-width: 120px;
    }
    .title-meta-label {
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #888;
      margin-bottom: 2px;
    }
    .title-meta-val {
      font-size: 13px;
      font-weight: 600;
    }

    /* Song sections — detailed layout */
    .song-section {
      page-break-inside: avoid;
      page-break-before: always;
      margin-bottom: 24px;
    }
    .song-section:first-of-type {
      page-break-before: auto;
    }
    .song-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #111;
      color: #fff;
      padding: 8px 12px;
      border-radius: 5px 5px 0 0;
      margin-bottom: 0;
    }
    .song-header-left {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .song-number {
      font-size: 10px;
      color: #aaa;
      font-weight: 400;
      min-width: 18px;
    }
    .song-title {
      font-size: 14px;
      font-weight: 700;
    }
    .song-header-right {
      display: flex;
      gap: 6px;
    }
    .song-meta-chip {
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
      padding: 2px 7px;
      font-size: 9px;
      letter-spacing: 0.04em;
    }
    .song-notes {
      background: #fffbe6;
      border-left: 3px solid #f5c518;
      padding: 5px 10px;
      font-size: 10px;
      color: #5a4a00;
      margin-bottom: 4px;
    }
    .section-label {
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #888;
      padding: 6px 4px 2px;
      border-bottom: 1px solid #eee;
      margin-bottom: 2px;
    }
    .empty-notice {
      color: #bbb;
      font-style: italic;
      font-size: 10px;
      padding: 6px 4px;
    }

    /* Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      page-break-inside: avoid;
    }
    .data-table thead th {
      text-align: left;
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #999;
      padding: 3px 6px;
      border-bottom: 1px solid #ddd;
    }
    .data-table tbody td {
      padding: 3px 6px;
      font-size: 10px;
      border-bottom: 1px solid #f0f0f0;
      vertical-align: middle;
    }
    .data-table tbody tr:last-child td {
      border-bottom: none;
    }

    /* Type badge */
    .type-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #fff;
      white-space: nowrap;
    }

    /* MIDI badge */
    .midi-badge {
      display: inline-block;
      background: #0096c8;
      color: #fff;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 700;
    }

    /* Compact layout */
    .section-page {
      page-break-inside: avoid;
    }
    .section-page-title {
      font-size: 18px;
      font-weight: 800;
      border-bottom: 2px solid #111;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .compact-table {
      width: 100%;
      border-collapse: collapse;
    }
    .compact-table thead th {
      background: #f0f0f0;
      text-align: left;
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #666;
      padding: 4px 8px;
    }
    .compact-table tbody td {
      padding: 4px 8px;
      font-size: 10px;
      border-bottom: 1px solid #eee;
      vertical-align: top;
    }
    .compact-sub-row td {
      padding: 2px 8px 6px;
      background: #fafafa;
      border-bottom: 1px solid #e0e0e0;
    }
    .compact-marker {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-right: 10px;
      font-size: 10px;
      margin-bottom: 2px;
    }
    .notes-cell {
      font-style: italic;
      color: #666;
      max-width: 200px;
    }

    /* Utilities */
    .mono { font-family: 'Consolas', 'Cascadia Code', 'Menlo', monospace; }
    .time-cell { width: 70px; color: #444; }

    /* Print media */
    @media print {
      .song-section { page-break-before: always; }
      .title-page { page-break-after: always; }
    }
  `

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${esc(presetName || 'Cue Sheet')}</title>
<style>${css}</style>
</head><body>
${titlePage}
${body}
</body></html>`
}
