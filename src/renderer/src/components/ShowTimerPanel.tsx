import React, { useEffect, useRef, useState } from 'react'
import { useStore, ShowTimer } from '../store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '../i18n'
import {
  computeRemaining,
  formatRemaining,
  hasCompleted,
  parseDurationInput,
} from '../utils/showTimer'

// How long the "completed" flash lasts after a timer reaches zero (AC, Q-F).
const FLASH_DURATION_MS = 5000

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

  // New-timer form
  const [newName, setNewName] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  // 1 Hz re-render tick. The actual remaining is derived from Date.now() at
  // each render, so a dropped interval just means a visual skip — the next
  // tick corrects. See AC-5.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(n => (n + 1) % 1_000_000), 500)
    return () => clearInterval(id)
  }, [])

  // Track which timer IDs are currently "flashing" red post-completion, with
  // a scheduled clear. We mark in state (so the class toggles) and rely on a
  // timeout to un-flash after FLASH_DURATION_MS.
  const [flashingIds, setFlashingIds] = useState<Set<string>>(() => new Set())
  const alreadyCompleted = useRef<Set<string>>(new Set())

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
        setTimeout(() => {
          setFlashingIds(prev => {
            const next = new Set(prev)
            next.delete(timer.id)
            return next
          })
        }, FLASH_DURATION_MS)
      }
      // Allow the same timer to flash again after it has been reset/restarted.
      if (!timer.running && timer.remainingMsAtStop > 0) {
        alreadyCompleted.current.delete(timer.id)
      }
    }
    // Clean up tracking for removed timers
    const liveIds = new Set(showTimers.map(t => t.id))
    for (const id of alreadyCompleted.current) {
      if (!liveIds.has(id)) alreadyCompleted.current.delete(id)
    }
  })

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
  }

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    handleAdd()
  }

  return (
    <div className="timer-panel">
      <div className="timer-header">
        <span className="timer-title">{t(lang, 'showTimerTitle')}</span>
      </div>

      <form className="timer-add-form" onSubmit={handleAddSubmit}>
        <input
          className="timer-add-name"
          type="text"
          value={newName}
          placeholder={t(lang, 'showTimerNamePlaceholder')}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={40}
          aria-label={t(lang, 'showTimerName')}
        />
        <input
          className="timer-add-duration"
          type="text"
          value={newDuration}
          placeholder={t(lang, 'showTimerDurationPlaceholder')}
          onChange={(e) => { setNewDuration(e.target.value); setInputError(null) }}
          aria-label={t(lang, 'showTimerDuration')}
        />
        <button type="submit" className="btn-sm timer-add-btn">
          {t(lang, 'showTimerAdd')}
        </button>
      </form>
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

interface TimerRowProps {
  timer: ShowTimer
  flashing: boolean
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

  const rowCls = [
    'timer-row',
    timer.running ? 'timer-row--running' : '',
    flashing ? 'timer-row--flashing' : '',
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
            className="timer-row-remaining"
            onDoubleClick={() => {
              if (timer.running) return
              setDurationDraft('')
              setEditingDuration(true)
            }}
            title={!timer.running ? t(lang, 'showTimerEditDuration') : ''}
          >
            {formatRemaining(remaining)}
          </span>
        )}
      </div>

      <div className="timer-row-controls">
        {timer.running ? (
          <button className="btn-sm" onClick={onStop}>{t(lang, 'showTimerStop')}</button>
        ) : (
          <button className="btn-sm timer-btn-start" onClick={onStart}>
            {t(lang, 'showTimerStart')}
          </button>
        )}
        <button className="btn-sm" onClick={onReset}>{t(lang, 'showTimerReset')}</button>
      </div>
    </div>
  )
}
