import { useState } from 'react'
import api from '../api'

export default function Settings() {
  const [tab, setTab] = useState('migrate')

  // Migration state
  const [migFile, setMigFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [migLoading, setMigLoading] = useState(false)
  const [migApplying, setMigApplying] = useState(false)
  const [migResult, setMigResult] = useState(null)
  const [error, setError] = useState('')

  // Config state
  const [configFile, setConfigFile] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [configLoading, setConfigLoading] = useState(false)

  // Audit state
  const [auditLog, setAuditLog] = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)

  const previewMigration = async () => {
    if (!migFile) return
    setMigLoading(true)
    setError('')
    setPreview(null)
    try {
      const form = new FormData()
      form.append('file', migFile)
      const res = await api.post('/migrate/truenas', form)
      setPreview(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to parse config')
    } finally {
      setMigLoading(false)
    }
  }

  const applyMigration = async () => {
    if (!migFile) return
    setMigApplying(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', migFile)
      const res = await api.post('/migrate/truenas/apply', form)
      setMigResult(res.data)
      setPreview(null)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to apply migration')
    } finally {
      setMigApplying(false)
    }
  }

  const exportConfig = async () => {
    try {
      const res = await api.get('/config/export', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `nas-config-${new Date().toISOString().slice(0,10)}.json`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError('Export failed')
    }
  }

  const importConfig = async () => {
    if (!configFile) return
    setConfigLoading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', configFile)
      const res = await api.post('/config/import', form)
      setImportResult(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Import failed')
    } finally {
      setConfigLoading(false)
    }
  }

  const loadAuditLog = async () => {
    setAuditLoading(true)
    try {
      const res = await api.get('/config/audit-log')
      setAuditLog(res.data)
    } catch (err) {
      setError('Failed to load audit log')
    } finally {
      setAuditLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Settings</h2>

      <div className="flex gap-2 mb-6">
        {['migrate', 'backup', 'audit'].map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === 'audit' && !auditLog) loadAuditLog() }}
            className={`px-4 py-2 text-sm rounded ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            {t === 'migrate' ? 'TrueNAS Import' : t === 'backup' ? 'Config Backup' : 'Audit Log'}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {/* TrueNAS Import */}
      {tab === 'migrate' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-2">Import TrueNAS Config</h3>
            <p className="text-sm text-gray-500 mb-4">
              Upload your TrueNAS config export (.tar file) to preview and import users, SMB shares,
              NFS exports, snapshot policies, scrub schedules, and cloud sync tasks.
              Credentials (e.g. B2 app keys) are encrypted in the export and must be re-entered after import.
            </p>

            <div className="flex items-center gap-3 mb-4">
              <input
                type="file"
                accept=".tar"
                onChange={e => { setMigFile(e.target.files[0]); setPreview(null); setMigResult(null) }}
                className="text-sm"
              />
              <button
                onClick={previewMigration}
                disabled={!migFile || migLoading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {migLoading ? 'Parsing...' : 'Preview'}
              </button>
            </div>

            {migResult && (
              <div className="p-4 bg-green-50 text-green-800 rounded text-sm">
                Migration applied successfully! Imported: {JSON.stringify(migResult.imported)}
              </div>
            )}
          </div>

          {preview && (
            <div className="space-y-4">
              {/* Users */}
              <div className="bg-white rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                  Users ({preview.users?.length || 0})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-4">Username</th><th className="pb-2 pr-4">UID</th><th className="pb-2">GID</th>
                    </tr></thead>
                    <tbody>
                      {(preview.users || []).filter(u => u.uid >= 1000 || [972].includes(u.uid)).map(u => (
                        <tr key={u.username} className="border-b last:border-0">
                          <td className="py-1 pr-4 font-medium">{u.username}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{u.uid}</td>
                          <td className="py-1 font-mono text-xs">{u.gid}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SMB Shares */}
              <div className="bg-white rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                  SMB Shares ({preview.smb_shares?.length || 0})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-4">Name</th><th className="pb-2 pr-4">Path</th><th className="pb-2">Comment</th>
                    </tr></thead>
                    <tbody>
                      {(preview.smb_shares || []).map(s => (
                        <tr key={s.name} className="border-b last:border-0">
                          <td className="py-1 pr-4 font-medium">{s.name}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{s.path}</td>
                          <td className="py-1 text-gray-500">{s.comment || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* NFS Exports */}
              <div className="bg-white rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                  NFS Exports ({preview.nfs_exports?.length || 0})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-4">Paths</th><th className="pb-2 pr-4">Hosts</th><th className="pb-2">Map Root</th>
                    </tr></thead>
                    <tbody>
                      {(preview.nfs_exports || []).map(e => (
                        <tr key={e.id} className="border-b last:border-0">
                          <td className="py-1 pr-4 font-mono text-xs">{e.paths}</td>
                          <td className="py-1 pr-4 text-xs">{e.hosts || '*'}</td>
                          <td className="py-1 text-xs text-gray-500">{e.maproot_user || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cloud Sync */}
              <div className="bg-white rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                  Cloud Sync Tasks ({preview.cloud_sync_tasks?.length || 0})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-4">Description</th><th className="pb-2 pr-4">Path</th><th className="pb-2 pr-4">Direction</th><th className="pb-2">Schedule</th>
                    </tr></thead>
                    <tbody>
                      {(preview.cloud_sync_tasks || []).map((t, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 pr-4 font-medium">{t.description}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{t.path}</td>
                          <td className="py-1 pr-4">{t.direction}</td>
                          <td className="py-1 font-mono text-xs">{t.schedule}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Scrub Tasks */}
              <div className="bg-white rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                  Scrub Tasks ({preview.scrub_tasks?.length || 0})
                </h4>
                {(preview.scrub_tasks || []).map((t, i) => (
                  <div key={i} className="text-sm py-1">
                    Pool: <span className="font-medium">{t.pool}</span> — Schedule: <span className="font-mono text-xs">{t.schedule}</span>
                  </div>
                ))}
              </div>

              {/* Apply Button */}
              <div className="flex justify-end">
                <button
                  onClick={applyMigration}
                  disabled={migApplying}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  {migApplying ? 'Applying...' : 'Apply Migration'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Config Backup/Restore */}
      {tab === 'backup' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-2">Export Config</h3>
            <p className="text-sm text-gray-500 mb-4">
              Download a backup of all snapshot policies, tasks, settings, smb.conf, and /etc/exports.
            </p>
            <button onClick={exportConfig} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              Download Config Backup
            </button>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-2">Import Config</h3>
            <p className="text-sm text-gray-500 mb-4">
              Restore from a previously exported config JSON file.
            </p>
            <div className="flex items-center gap-3">
              <input type="file" accept=".json" onChange={e => setConfigFile(e.target.files[0])} className="text-sm" />
              <button
                onClick={importConfig}
                disabled={!configFile || configLoading}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {configLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
            {importResult && (
              <div className="mt-3 p-3 bg-green-50 text-green-800 rounded text-sm">
                Imported: {JSON.stringify(importResult.imported)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audit Log */}
      {tab === 'audit' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="text-lg font-semibold">Audit Log</h3>
            <button onClick={loadAuditLog} className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300">Refresh</button>
          </div>
          {auditLoading ? (
            <div className="p-4 text-gray-500 text-sm">Loading...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Time</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">User</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Action</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Resource</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">IP</th>
                </tr>
              </thead>
              <tbody>
                {(auditLog || []).map(entry => (
                  <tr key={entry.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500">{entry.timestamp}</td>
                    <td className="px-4 py-2">{entry.username}</td>
                    <td className="px-4 py-2"><span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{entry.action}</span></td>
                    <td className="px-4 py-2 font-mono text-xs">{entry.resource}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{entry.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
