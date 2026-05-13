import React, { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'
import { ProGate } from './ProGate'

export function PresetBar(): React.JSX.Element {
  const {
    presetName, presetDirty, savedPresets, lang,
    newPreset, savePreset, savePresetAs, loadPreset, deletePreset,
    openProject, openRecentFile,
    packageProject, importProject,
    shareProjectZip, importLtcastProject
  } = useStore()

  const handleNew = useCallback((): void => {
    newPreset()
  }, [newPreset])

  const handleSave = useCallback((): void => {
    savePreset()
  }, [savePreset])

  const handleSaveAs = useCallback((): void => {
    savePresetAs()
  }, [savePresetAs])

  const handleOpen = useCallback((): void => {
    openProject()
  }, [openProject])

  const handleLoad = useCallback((e: React.ChangeEvent<HTMLSelectElement>): void => {
    const name = e.target.value
    if (name) loadPreset(name)
  }, [loadPreset])

  const handlePackageProject = useCallback(async (): Promise<void> => {
    const path = await packageProject()
    if (path) {
      toast.success(t(lang, 'projectPackaged'))
    }
  }, [packageProject, lang])

  const handleImportProject = useCallback(async (): Promise<void> => {
    const ok = await importProject()
    if (ok) {
      toast.success(t(lang, 'projectImported'))
    }
  }, [importProject, lang])

  const handleShareProjectZip = useCallback(async (): Promise<void> => {
    const path = await shareProjectZip()
    if (path) {
      toast.success(t(lang, 'shareAsZipSuccess'))
    }
  }, [shareProjectZip, lang])

  const handleImportLtcastProject = useCallback(async (): Promise<void> => {
    const ok = await importLtcastProject()
    if (ok) {
      toast.success(t(lang, 'projectImported'))
    }
  }, [importLtcastProject, lang])

  // Use ref for openRecentFile to avoid re-registering the listener
  const openRecentRef = useRef(openRecentFile)
  openRecentRef.current = openRecentFile

  // Listen for native File menu commands
  useEffect(() => {
    const handleOpenRecent = (path: unknown): void => {
      if (typeof path === 'string') openRecentRef.current(path)
    }

    const unsubs = [
      window.api.onMenuCommand('menu-new-preset', handleNew),
      window.api.onMenuCommand('menu-save-preset', handleSave),
      window.api.onMenuCommand('menu-save-preset-as', handleSaveAs),
      window.api.onMenuCommand('menu-import-preset', handleOpen),
      window.api.onMenuCommand('menu-package-project', handlePackageProject),
      window.api.onMenuCommand('menu-import-project', handleImportProject),
      window.api.onMenuCommand('menu-share-project', handleShareProjectZip),
      window.api.onMenuCommand('menu-import-ltcastproject', handleImportLtcastProject),
      window.api.onMenuCommand('menu-open-recent', handleOpenRecent)
    ]
    return () => unsubs.forEach(fn => fn())
  }, [handleNew, handleSave, handleSaveAs, handleOpen, handlePackageProject, handleImportProject, handleShareProjectZip, handleImportLtcastProject])

  return (
    <div className="preset-bar">
      <select
        className="preset-select"
        value={presetName ?? ''}
        onChange={handleLoad}
      >
        <option value="">— {t(lang, 'saved')} —</option>
        {savedPresets.map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>

      {presetName && presetDirty && (
        <span className="preset-dirty" title={t(lang, 'unsaved')}>*</span>
      )}

      {presetName && (
        <button
          className="btn-preset btn-preset--danger"
          onClick={async () => {
            const msg = t(lang, 'confirmDelete').replace('{name}', presetName)
            const ok = await window.api.showConfirmDialog(msg)
            if (ok) deletePreset(presetName)
          }}
          title={t(lang, 'delete')}
        >
          {t(lang, 'delete')}
        </button>
      )}

      <ProGate>
        <button
          className="btn-preset"
          onClick={handleShareProjectZip}
          title={t(lang, 'shareAsZip')}
        >
          {t(lang, 'shareAsZip')}
        </button>
      </ProGate>

      <button
        className="btn-preset"
        onClick={handleImportLtcastProject}
        title={t(lang, 'importLtcastProject')}
      >
        {t(lang, 'importLtcastProject')}
      </button>
    </div>
  )
}
