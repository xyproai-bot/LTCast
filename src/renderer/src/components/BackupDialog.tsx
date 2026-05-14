import React, { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'

interface BackupEntry {
  path: string
  timestamp: string
  sizeBytes: number
}

interface Props {
  presetName: string
  onClose: () => void
  onRestored: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatTimestamp(ts: string): string {
  try {
    // timestamp comes back as ISO-ish string like "2025-05-14T10-30-00" from filename
    const normalized = ts.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3')
    const d = new Date(normalized)
    if (isNaN(d.getTime())) return ts
    return d.toLocaleString()
  } catch { return ts }
}

export function BackupDialog({ presetName, onClose, onRestored }: Props): React.JSX.Element {
  const { lang } = useStore()
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadBackups = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.listBackups(presetName)
      setBackups(list)
    } catch (e) {
      console.error('[BackupDialog] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [presetName])

  useEffect(() => {
    loadBackups()
  }, [loadBackups])

  const handleRestore = useCallback(async (entry: BackupEntry): Promise<void> => {
    const confirmed = await window.api.showConfirmDialog(
      t(lang, 'backupRestoreConfirm')
    ).catch(() => false)
    if (!confirmed) return

    setRestoring(entry.path)
    try {
      const result = await window.api.restoreBackup(entry.path)
      if (!result) {
        toast.error('Backup not found')
        return
      }
      // Apply the restored preset data by delegating to store's loadPresetData path.
      // We mimic the load flow: apply data to store then mark as dirty.
      const s = useStore.getState()
      // Use the existing openProject flow would reset too much; instead we simulate
      // the same logic used when loading a preset file.
      // Import the migration function via a dynamic import of the store module is
      // not practical, so we call window.api.savePreset then loadPreset to reload cleanly.
      // Simpler: just write a temp preset, reload it. But that is complex.
      // Best approach: update store state directly mirroring what loadPreset does.
      // Since we can't call migratePreset here (it's not exported), we use a workaround:
      // dispatch loadPreset by writing to a temp slot then loading it.
      // For now, use the raw data application path via IPC save+load.
      const tempName = `__backup_restore_${Date.now()}`
      await window.api.savePreset(tempName, result.data)
      s.loadPreset(tempName)
      // Clean up temp preset after a tick
      setTimeout(() => window.api.deletePreset(tempName).catch(() => {}), 2000)
      toast.success(t(lang, 'backupRestored'))
      onRestored()
      onClose()
    } catch (e) {
      console.error('[BackupDialog] restore failed', e)
      toast.error('Restore failed')
    } finally {
      setRestoring(null)
    }
  }, [lang, onClose, onRestored])

  const handleDelete = useCallback(async (entry: BackupEntry): Promise<void> => {
    const confirmed = await window.api.showConfirmDialog(
      t(lang, 'backupDeleteConfirm')
    ).catch(() => false)
    if (!confirmed) return

    setDeleting(entry.path)
    try {
      await window.api.deleteBackup(entry.path)
      toast.success(t(lang, 'backupDeleted'))
      await loadBackups()
    } catch (e) {
      console.error('[BackupDialog] delete failed', e)
    } finally {
      setDeleting(null)
    }
  }, [lang, loadBackups])

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    await window.api.openBackupFolder(presetName).catch(() => {})
  }, [presetName])

  return (
    <div className="ltc-wav-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ltc-wav-dialog" style={{ minWidth: 480, maxWidth: 640 }}>
        {/* Header */}
        <div className="ltc-wav-dialog-header">
          <div>
            <div className="ltc-wav-dialog-title">{t(lang, 'backupsDialogTitle')}</div>
            <div className="ltc-wav-dialog-sub">{presetName}</div>
          </div>
          <button className="ltc-wav-dialog-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
              <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </div>

        {/* Backup list */}
        <div style={{ padding: '12px 16px', maxHeight: 420, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 24 }}>Loading…</div>
          ) : backups.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 24 }}>{t(lang, 'noBackups')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333', color: '#888' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>Timestamp</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>{t(lang, 'backupSize')}</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {backups.map(entry => (
                  <tr key={entry.path} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '6px 8px', color: '#ddd' }}>{formatTimestamp(entry.timestamp)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#888', fontFamily: 'monospace', fontSize: 12 }}>
                      {formatBytes(entry.sizeBytes)}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn-preset"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          disabled={restoring === entry.path}
                          onClick={() => handleRestore(entry)}
                        >
                          {restoring === entry.path ? '…' : t(lang, 'restoreBackup')}
                        </button>
                        <button
                          className="btn-preset btn-preset--danger"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          disabled={deleting === entry.path}
                          onClick={() => handleDelete(entry)}
                        >
                          {deleting === entry.path ? '…' : '✕'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn-preset" onClick={handleOpenFolder} style={{ fontSize: 12 }}>
            {t(lang, 'openBackupFolder')}
          </button>
          <button className="btn-preset" onClick={onClose}>{t(lang, 'cancel')}</button>
        </div>
      </div>
    </div>
  )
}
