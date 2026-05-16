import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, ShowTimer } from '../store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '../i18n'
import {
  computeRemaining,
  formatRemaining,
  hasCompleted,
  parseDurationInput,
} from '../utils/showTimer'
import { beep } from '../utils/beep'

// How long the "completed" flash lasts after a timer reaches zero (AC, Q-F).
const FLASH_DURATION_MS = 5000

// Quick-add presets — hardcoded; nameKey is an i18n key resolved at render time.
// Durations are stored in ms so the addShowTimer signature stays unchanged.
const QUICK_PRESETS: ReadonlyArray<{ id: 'doors' | 'intermission' | 'lockout'; nameKey: 'showTimerPresetDoors' | 'showTimerPresetIntermission' | 'showTimerPresetLockout'; durationMs: number }> = [
  { id: 'doors',         nameKey: 'showTimerPresetDoors',         durationMs: 15 * 60_000 },
  { id: 'intermission',  nameKey: 'showTimerPresetIntermission',  durationMs: 20 * 60_000 },
  { id: 'lockout',       nameKey: 'showTimerPresetLockout',       durationMs:  2 * 60_000 },
]

// Duration chips — purely fill the duration input. Labels are display-only;
// values are minutes. No i18n needed (units are universal: "5m"/"60m").
const DURATION_CHIPS: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: '5m',  minutes:  5 },
  { label: '10m', minutes: 10 },
  { label: '15m', minutes: 15 },
  { label: '20m', minutes: 20 },
  { label: '30m', minutes: 30 },
  { label: '45m', minutes: 45 },
  { label: '60m', minutes: 60 },
]

export function ShowTimerPanel(): React.JSX.Element {
  const lang = useStore(s => s.lang)

  // useShallow keeps the panel from re-rendering on unrelated store updates.
  const {
    showTimers,
    addShowTimer,
    removeShowTimer,
    startShowTimer,
    stopShowTimer,
    resetShowTimer,
    renameShowTimer,
    setShowTimerDuration,
    markShowTimerCompleted,
  } = useStore(useShallow(s => ({
    showTimers: s.showTimers,
    addShowTimer: s.addShowTimer,
    removeShowTimer: s.removeShowTimer,
    startShowTimer: s.startShowTimer,
    stopShowTimer: s.stopShowTimer,
    resetShowTimer: s.resetShowTimer,
    renameShowTimer: s.renameShowTimer,
    setShowTimerDuration: s.setShowTimerDuration,
    markShowTimerCompleted: s.markShowTimerCompleted,
  })))

  // Custom-form is collapsed by default; the preset row is the primary path
  // for adding timers. Click "Custom…" to reveal the name+duration form.
  const [customOpen, setCustomOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  // 1 Hz re-render tick. The actual remaining is derived from Date.now() at
  // each render, so a dropped interval just means a visual skip — the next
  // tick corrects. See AC-5. 1000 ms (not 500 ms) because the display is
  // whole-second resolution; ticking twice per second was pure CPU waste.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(n => (n + 1) % 1_000_000), 1000)
    return () => clearInterval(id)
  }, [])

  // Track which timer IDs are currently "flashing" red post-completion, with
  // a scheduled clear. We mark in state (so the class toggles) and rely on a
  // timeout to un-flash after FLASH_DURATION_MS.
  const [flashingIds, setFlashingIds] = useState<Set<string>>(() => new Set())
  // Track which timer IDs are currently in the "completed" state. Separate
  // from `flashingIds` because the DONE badge persists past the 5 s flash.
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set())
  const alreadyCompleted = useRef<Set<string>>(new Set())
  // Track in-flight flash-clear timeouts so unmount can cancel them before
  // they fire setState on a dead component (React would warn + keep the
  // scheduled closure alive until it fires).
  const flashTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => {
    const now = Date.now()
    for (const timer of showTimers) {
      if (timer.running && hasCompleted(timer, now) && !alreadyCompleted.current.has(timer.id)) {
        alreadyCompleted.current.add(timer.id)
        // Stop it in the store (flips running=false, pins remaining=0)
        markShowTimerCompleted(timer.id)
        // Flash the row
        setFlashingIds(prev => {
          const next = new Set(prev)
          next.add(timer.id)
          return next
        })
        // Persistent DONE badge — cleared on Reset (handled below).
        setCompletedIds(prev => {
          const next = new Set(prev)
          next.add(timer.id)
          return next
        })
        // Audible completion alert: 440Hz × 200ms × 2. Safe no-op in jsdom.
        beep(440, 200, 2)
        const handle = setTimeout(() => {
          flashTimeoutsRef.current.delete(handle)
          setFlashingIds(prev => {
            const next = new Set(prev)
            next.delete(timer.id)
            return next
          })
        }, FLASH_DURATION_MS)
        flashTimeoutsRef.current.add(handle)
      }
      // Allow the same timer to flash again after it has been reset/restarted.
      // remainingMsAtStop > 0 is the signature of a Reset (or a Pause with
      // time left). Either way we should clear the "DONE" badge so a Resume
      // doesn't visually claim it's already done.
      if (!timer.running && timer.remainingMsAtStop > 0) {
        alreadyCompleted.current.delete(timer.id)
        if (completedIds.has(timer.id)) {
          setCompletedIds(prev => {
            const next = new Set(prev)
            next.delete(timer.id)
            return next
          })
        }
      }
    }
    // Clean up tracking for removed timers
    const liveIds = new Set(showTimers.map(t => t.id))
    for (const id of alreadyCompleted.current) {
      if (!liveIds.has(id)) alreadyCompleted.current.delete(id)
    }
    if (completedIds.size > 0) {
      let needsPrune = false
      for (const id of completedIds) {
        if (!liveIds.has(id)) { needsPrune = true; break }
      }
      if (needsPrune) {
        setCompletedIds(prev => {
          const next = new Set<string>()
          for (const id of prev) if (liveIds.has(id)) next.add(id)
          return next
        })
      }
    }
  })

  // On unmount, cancel any flash timeouts still in the air so they don't
  // fire setState on a dead panel.
  useEffect(() => {
    const pending = flashTimeoutsRef.current
    return () => {
      for (const h of pending) clearTimeout(h)
      pending.clear()
    }
  }, [])

  const handleAdd = (): void => {
    const parsed = parseDurationInput(newDuration)
    if (parsed === null) {
      setInputError(t(lang, 'showTimerDurationError'))
      return
    }
    const name = newName.trim() || t(lang, 'showTimerDefaultName')
    addShowTimer(name, parsed)
    setNewName('')
    setNewDuration('')
    setInputError(null)
    // Keep the custom form open for the next add — fewer clicks during prep.
  }

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    handleAdd()
  }

  const handlePresetClick = (presetId: typeof QUICK_PRESETS[number]['id']): void => {
    const preset = QUICK_PRESETS.find(p => p.id === presetId)
    if (!preset) return
    addShowTimer(t(lang, preset.nameKey), preset.durationMs)
  }

  const handleChipClick = (minutes: number): void => {
    setNewDuration(String(minutes))
    setInputError(null)
  }

  // Memoized preset names so the row doesn't rebuild on every keystroke.
  const presetButtons = useMemo(() => QUICK_PRESETS.map(p => ({
    id: p.id,
    name: t(lang, p.nameKey),
    label: `+ ${t(lang, p.nameKey)} ${formatPresetDuration(p.durationMs)}`,
  })), [lang])

  return (
    <div className="timer-panel">
      <div className="timer-header">
        <span className="timer-title">{t(lang, 'showTimerTitle')}</span>
      </div>

      {/* Quick-add preset row — primary path. Custom expands to the form. */}
      <div className="timer-presets" role="group" aria-label={t(lang, 'showTimerQuickAdd')}>
        {presetButtons.map(p => (
          <button
            key={p.id}
            type="button"
            className="timer-preset-btn"
            onClick={() => handlePresetClick(p.id)}
            title={p.name}
          >{p.label}</button>
        ))}
        <button
          type="button"
          className={['timer-preset-btn', 'timer-preset-btn--custom', customOpen ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => setCustomOpen(v => !v)}
          aria-expanded={customOpen}
        >+ {t(lang, 'showTimerPresetCustom')}</button>
      </div>

      {customOpen && (
        <form className="timer-add-form" onSubmit={handleAddSubmit}>
          <div className="timer-field">
            <label className="timer-field-label" htmlFor="showtimer-name">
              {t(lang, 'showTimerNameLabel')}
            </label>
            <input
              id="showtimer-name"
              className="timer-add-name"
              type="text"
              value={newName}
              placeholder={t(lang, 'showTimerNamePlaceholderV2')}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={40}
              aria-label={t(lang, 'showTimerName')}
            />
          </div>

          <div className="timer-field">
            <label className="timer-field-label" htmlFor="showtimer-duration">
              {t(lang, 'showTimerDurationLabel')}
            </label>
            <input
              id="showtimer-duration"
              className="timer-add-duration"
              type="text"
              value={newDuration}
              placeholder={t(lang, 'showTimerDurationPlaceholderV2')}
              onChange={(e) => { setNewDuration(e.target.value); setInputError(null) }}
              aria-label={t(lang, 'showTimerDuration')}
            />
            <div className="timer-duration-chips" role="group">
              {DURATION_CHIPS.map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  className="timer-chip"
                  onClick={() => handleChipClick(chip.minutes)}
                  aria-label={`${chip.minutes} ${t(lang, 'showTimerDuration')}`}
                >{chip.label}</button>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-sm timer-add-btn">
            {t(lang, 'showTimerAdd')}
          </button>
        </form>
      )}

      {inputError && <div className="timer-input-error">{inputError}</div>}

      <div className="timer-list">
        {showTimers.length === 0 ? (
          <div className="timer-empty">{t(lang, 'showTimerEmpty')}</div>
        ) : (
          showTimers.map((timer) => (
            <TimerRow
              key={timer.id}
              timer={timer}
              flashing={flashingIds.has(timer.id)}
              completed={completedIds.has(timer.id)}
              onStart={() => startShowTimer(timer.id)}
              onStop={() => stopShowTimer(timer.id)}
              onReset={() => resetShowTimer(timer.id)}
              onRemove={() => removeShowTimer(timer.id)}
              onRename={(name) => renameShowTimer(timer.id, name)}
              onSetDuration={(ms) => setShowTimerDuration(timer.id, ms)}
              lang={lang}
            />
          ))
        )}
      </div>
    </div>
  )
}

// Compact display string for preset durations, e.g. "15:00" / "2:00".
// Kept in the file rather than shared because no other caller exists.
function formatPresetDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface TimerRowProps {
  timer: ShowTimer
  flashing: boolean
  completed: boolean
  onStart: () => void
  onStop: () => void
  onReset: () => void
  onRemove: () => void
  onRename: (name: string) => void
  onSetDuration: (ms: number) => void
  lang: 'en' | 'zh' | 'ja'
}

function TimerRow({
  timer,
  flashing,
  completed,
  onStart,
  onStop,
  onReset,
  onRemove,
  onRename,
  onSetDuration,
  lang,
}: TimerRowProps): React.JSX.Element {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(timer.name)
  const [editingDuration, setEditingDuration] = useState(false)
  const [durationDraft, setDurationDraft] = useState('')

  const remaining = computeRemaining(timer, Date.now())

  const commitName = (): void => {
    const next = nameDraft.trim()
    if (next && next !== timer.name) onRename(next)
    setNameDraft(timer.name)
    setEditingName(false)
  }

  const commitDuration = (): void => {
    const parsed = parseDurationInput(durationDraft)
    if (parsed !== null) onSetDuration(parsed)
    setDurationDraft('')
    setEditingDuration(false)
  }

  // Progress bar fill — fraction of duration elapsed.
  // Stopped+untouched (remainingMsAtStop == durationMs) → 0 % (empty bar).
  // While running, progress climbs from 0→1 toward the deadline.
  const progress = timer.durationMs > 0
    ? Math.max(0, Math.min(1, (timer.durationMs - remaining) / timer.durationMs))
    : 0

  // Tier the remaining display + progress bar by urgency.
  //   <60s   → orange (warn)
  //   <10s   → red (critical, also bold via class)
  //   >=70%  → progress bar shifts orange
  //   >=90%  → progress bar shifts red
  const urgent10 = timer.running && remaining > 0 && remaining < 10_000
  const urgent60 = timer.running && remaining > 0 && remaining < 60_000
  const progressTier =
    progress >= 0.9 ? 'critical' :
    progress >= 0.7 ? 'warn' : 'ok'

  // Click-to-edit duration replaces the previous double-click contract.
  // Editing locked while running so a tap mid-show can't accidentally rewrite
  // the remaining (the underlying setShowTimerDuration only resets the
  // remaining while idle, but visually disabling avoids the surprise).
  const canEditDuration = !timer.running
  const beginEditDuration = (): void => {
    if (!canEditDuration) return
    setDurationDraft('')
    setEditingDuration(true)
  }

  // Pause/Resume button logic. The store's stopShowTimer already pins
  // remainingMsAtStop, so a stopped timer with remainingMsAtStop < durationMs
  // is effectively paused — Resume picks up where Pause left it.
  //   running                          → "Pause"
  //   paused (remaining < durationMs)  → "Resume"
  //   fresh/reset                      → "Start"
  // (completed flashes red and shows DONE; user must Reset before Start.)
  type ControlMode = 'pause' | 'resume' | 'start'
  let controlMode: ControlMode = 'start'
  if (timer.running) controlMode = 'pause'
  else if (!completed && timer.remainingMsAtStop > 0 && timer.remainingMsAtStop < timer.durationMs) controlMode = 'resume'

  const controlLabel =
    controlMode === 'pause'  ? t(lang, 'showTimerPause')  :
    controlMode === 'resume' ? t(lang, 'showTimerResume') :
                               t(lang, 'showTimerStart')

  const rowCls = [
    'timer-row',
    timer.running ? 'timer-row--running' : '',
    flashing ? 'timer-row--flashing' : '',
    completed ? 'timer-row--completed' : '',
  ].filter(Boolean).join(' ')

  const remainingCls = [
    'timer-row-remaining',
    urgent10 ? 'is-urgent-10' : urgent60 ? 'is-urgent-60' : '',
    !timer.running && !completed ? 'is-idle' : '',
    canEditDuration ? 'is-editable' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={rowCls}>
      <div className="timer-row-top">
        {editingName ? (
          <input
            className="timer-row-name-input"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.currentTarget.blur() }
              else if (e.key === 'Escape') { setNameDraft(timer.name); setEditingName(false) }
            }}
            maxLength={40}
          />
        ) : (
          <span
            className="timer-row-name"
            title={t(lang, 'showTimerRename')}
            onDoubleClick={() => { setNameDraft(timer.name); setEditingName(true) }}
          >
            {timer.name}
          </span>
        )}
        {completed && (
          <span className="timer-completed-tag" aria-label={t(lang, 'showTimerCompletedTag')}>
            ⏰ {t(lang, 'showTimerCompletedTag')}
          </span>
        )}
        <button
          className="timer-row-remove"
          title={t(lang, 'showTimerRemove')}
          onClick={onRemove}
          aria-label={t(lang, 'showTimerRemove')}
        >×</button>
      </div>

      <div className="timer-row-time">
        {editingDuration ? (
          <input
            className="timer-row-time-input"
            autoFocus
            value={durationDraft}
            onChange={(e) => setDurationDraft(e.target.value)}
            onBlur={commitDuration}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.currentTarget.blur() }
              else if (e.key === 'Escape') { setDurationDraft(''); setEditingDuration(false) }
            }}
            placeholder={t(lang, 'showTimerDurationPlaceholder')}
          />
        ) : (
          <span
            className={remainingCls}
            onClick={beginEditDuration}
            title={canEditDuration
              ? t(lang, 'showTimerEditDurationHint')
              : t(lang, 'showTimerEditDurationLocked')}
            role={canEditDuration ? 'button' : undefined}
            tabIndex={canEditDuration ? 0 : -1}
            onKeyDown={(e) => {
              if (!canEditDuration) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                beginEditDuration()
              }
            }}
          >
            {formatRemaining(remaining)}
            {canEditDuration && <span className="timer-edit-pencil" aria-hidden>✎</span>}
          </span>
        )}
      </div>

      {/* Progress bar. Always rendered so layout doesn't jump; width is 0
          when the timer is at its initial state (remaining == durationMs). */}
      <div className="timer-progress-bar" aria-hidden>
        <div
          className={`timer-progress-fill timer-progress-fill--${progressTier}`}
          style={{ width: `${(progress * 100).toFixed(2)}%` }}
        />
      </div>

      <div className="timer-row-controls">
        {controlMode === 'pause' ? (
          <button className="btn-sm timer-btn-pause" onClick={onStop}>{controlLabel}</button>
        ) : (
          <button
            className={`btn-sm ${controlMode === 'resume' ? 'timer-btn-resume' : 'timer-btn-start'}`}
            onClick={onStart}
          >{controlLabel}</button>
        )}
        <button className="btn-sm" onClick={onReset}>{t(lang, 'showTimerReset')}</button>
      </div>
    </div>
  )
}
