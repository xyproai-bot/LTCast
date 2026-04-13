import React, { useEffect, useState, useCallback, useRef } from 'react'

export interface ToastMessage {
  id: number
  text: string
  type: 'info' | 'success' | 'error' | 'warning'
  actionLabel?: string
  onAction?: () => void
}

let _nextId = 0
let _addToast: ((msg: Omit<ToastMessage, 'id'>) => number) | null = null
let _removeToast: ((id: number) => void) | null = null

/** Global toast API — call from anywhere (no hook needed) */
export const toast = {
  info:    (text: string): number => _addToast?.({ text, type: 'info' }) ?? 0,
  success: (text: string): number => _addToast?.({ text, type: 'success' }) ?? 0,
  error:   (text: string): number => _addToast?.({ text, type: 'error' }) ?? 0,
  warning: (text: string): number => _addToast?.({ text, type: 'warning' }) ?? 0,
  /** Toast with a clickable action button. Does NOT auto-dismiss. Returns toast ID. */
  action:  (text: string, actionLabel: string, onAction: () => void, type: ToastMessage['type'] = 'warning'): number =>
    _addToast?.({ text, type, actionLabel, onAction }) ?? 0,
  /** Dismiss a toast by ID */
  dismiss: (id: number): void => { _removeToast?.(id) }
}

const DURATION = 4000

export function ToastContainer(): React.JSX.Element {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id))
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
  }, [])

  const addToast = useCallback((msg: Omit<ToastMessage, 'id'>): number => {
    const id = ++_nextId
    setMessages(prev => [...prev.slice(-4), { ...msg, id }]) // keep max 5
    // Action toasts are persistent — no auto-dismiss
    if (!msg.onAction) {
      const t = setTimeout(() => removeToast(id), DURATION)
      timers.current.set(id, t)
    }
    return id
  }, [removeToast])

  useEffect(() => {
    _addToast = addToast
    _removeToast = removeToast
    return () => {
      _addToast = null
      _removeToast = null
      // Clear all pending timers on unmount
      timers.current.forEach(t => clearTimeout(t))
      timers.current.clear()
    }
  }, [addToast, removeToast])

  if (messages.length === 0) return <></>

  return (
    <div className="toast-container">
      {messages.map(m => (
        <div
          key={m.id}
          className={`toast toast-${m.type}`}
          onClick={() => !m.onAction && removeToast(m.id)}
        >
          <span className="toast-icon">
            {m.type === 'success' ? '✓' : m.type === 'error' ? '✗' : m.type === 'warning' ? '!' : 'i'}
          </span>
          <span className="toast-text">{m.text}</span>
          {m.actionLabel && m.onAction && (
            <button
              className="toast-action"
              onClick={(e) => { e.stopPropagation(); m.onAction!(); removeToast(m.id) }}
            >
              {m.actionLabel}
            </button>
          )}
          {m.onAction && (
            <button
              className="toast-dismiss"
              onClick={(e) => { e.stopPropagation(); removeToast(m.id) }}
            >✕</button>
          )}
        </div>
      ))}
    </div>
  )
}
