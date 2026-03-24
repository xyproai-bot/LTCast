import React, { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  text: string
  children: React.ReactNode
  delay?: number
}

export function Tooltip({ text, children, delay = 700 }: Props): React.JSX.Element {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)

  const onEnter = useCallback((): void => {
    timerRef.current = setTimeout(() => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (r) setPos({ x: r.left + r.width / 2, y: r.top })
    }, delay)
  }, [delay])

  const onLeave = useCallback((): void => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setPos(null)
  }, [])

  return (
    <>
      <span ref={wrapRef} className="tooltip-host" onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {children}
      </span>
      {pos !== null && createPortal(
        <div className="tooltip-bubble" style={{ left: pos.x, top: pos.y }}>
          {text}
        </div>,
        document.body
      )}
    </>
  )
}
