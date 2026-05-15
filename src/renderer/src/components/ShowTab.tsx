/**
 * Sprint UI-Reorg-Option-A — ShowTab
 *
 * Wraps ShowTimerPanel (top half) + ShowLogPanel (bottom half) into the new
 * "Show" right-panel tab. Both child panels are mounted unchanged — this
 * component only does layout + empty-state for the log half.
 *
 * Empty state (AC-12.2): the timer half is always visible (timers are a
 * standalone tool, not log entries). When the show log buffer is empty,
 * the bottom half shows clock icon + "No events yet" + hint text.
 */

import React from 'react'
import { useStore } from '../store'
import { showLog } from '../utils/showLog'
import { t } from '../i18n'
import { ShowTimerPanel } from './ShowTimerPanel'
import { ShowLogPanel } from './ShowLogPanel'

export function ShowTab(): React.JSX.Element {
  const lang = useStore(s => s.lang)
  // Subscribe to log length so empty-state flips when the first event lands.
  const [logCount, setLogCount] = React.useState<number>(() => showLog.getEntries().length)

  React.useEffect(() => {
    const unsub = showLog.subscribe(() => setLogCount(showLog.getEntries().length))
    return unsub
  }, [])

  return (
    <div className="show-tab">
      <div className="show-tab__half show-tab__top">
        <ShowTimerPanel />
      </div>
      <div className="show-tab__divider" />
      <div className="show-tab__half show-tab__bottom">
        {logCount === 0 ? (
          <div className="tab-empty-state">
            <div className="tab-empty-state__icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="tab-empty-state__title">{t(lang, 'emptyShowTitle')}</div>
            <div className="tab-empty-state__hint">{t(lang, 'emptyShowHint')}</div>
          </div>
        ) : (
          <ShowLogPanel />
        )}
      </div>
    </div>
  )
}
