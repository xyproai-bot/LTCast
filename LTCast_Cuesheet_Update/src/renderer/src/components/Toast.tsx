import React, { useEffect, useState, useCallback, useRef } from 'react'

export interface ToastMessage {
  id: number
  text: string
  type: 'info' | 'success' | 'error' | 'warning'
}

let _nextId = 0
let _addToast: ((msg: Omit<ToastMessage, 'id'>) => void) | null = null

/** Global toast API — call from anywhere (no hook needed) */
export const toast = {
  info:    (text: string) => _addToast?.({ text, type: 'info' }),
  success: (text: string) => _addToast?.({ text, type: 'success' }),
  error:   (text: string) => _addToast?.({ text, type: 'error' }),
  warning: (text: string) => _addToast?.({ text, type: 'warning' })
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

  const addToast = useCallback((msg: Omit<ToastMessage, 'id'>) => {
    const id = ++_nextId
    setMessages(prev => [...prev.slice(-4), { ...msg, id }]) // keep max 5
    const t = setTimeout(() => removeToast(id), DURATION)
    timers.current.set(id, t)
  }, [removeToast])

  useEffect(() => {
    _addToast = addToast
    return () => {
      _addToast = null
      // Clear all pending timers on unmount
      timers.current.forEach(t => clearTimeout(t))
      timers.current.clear()
    }
  }, [addToast])

  if (messages.length === 0) return <></>

  return (
    <div className="toast-container">
      {messages.map(m => (
        <div
          key={m.id}
          className={`toast toast-${m.type}`}
          onClick={() => removeToast(m.id)}
        >
          <span className="toast-icon">
            {m.type === 'success' ? '✓' : m.type === 'error' ? '✗' : m.type === 'warning' ? '!' : 'i'}
          </span>
          <span className="toast-text">{m.text}</span>
        </div>
      ))}
    </div>
  )
}
