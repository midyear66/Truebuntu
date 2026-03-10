import { useState, useEffect } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Settings() {
  const [tab, setTab] = useState('general')

  // General state
  const [hostname, setHostname] = useState('')
  const [timezone, setTimezone] = useState('')
  const [timezones, setTimezones] = useState([])
  const [generalLoading, setGeneralLoading] = useState(false)
  const [generalSaving, setGeneralSaving] = useState(false)
  const [generalMsg, setGeneralMsg] = useState('')

  // NTP state
  const [ntpServers, setNtpServers] = useState([])
  const [ntpLoading, setNtpLoading] = useState(false)
  const [ntpAddress, setNtpAddress] = useState('')
  const [ntpIburst, setNtpIburst] = useState(true)
  const [ntpPrefer, setNtpPrefer] = useState(false)

  // Migration state
  const [migFile, setMigFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [migLoading, setMigLoading] = useState(false)
  const [migApplying, setMigApplying] = useState(false)
  const [migResult, setMigResult] = useState(null)
  const [migErrors, setMigErrors] = useState([])
  const [userPasswords, setUserPasswords] = useState({})
  const [importUsers, setImportUsers] = useState(true)
  const [importSmbShares, setImportSmbShares] = useState(true)
  const [error, setError] = useState('')

  // Config state
  const [configFile, setConfigFile] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [configLoading, setConfigLoading] = useState(false)

  // Audit state
  const [auditLog, setAuditLog] = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)

  // Power state
  const [powerConfirm, setPowerConfirm] = useState(null) // 'reboot' or 'shutdown'
  const [powerMsg, setPowerMsg] = useState('')

  // 2FA state
  const [tfaEnabled, setTfaEnabled] = useState(false)
  const [tfaLoading, setTfaLoading] = useState(false)
  const [tfaSetup, setTfaSetup] = useState(null)
  const [tfaCode, setTfaCode] = useState('')
  const [tfaDisableCode, setTfaDisableCode] = useState('')
  const [tfaMsg, setTfaMsg] = useState('')

  // Load general settings on mount
  useEffect(() => {
    loadGeneral()
  }, [])

  const loadGeneral = async () => {
    setGeneralLoading(true)
    try {
      const res = await api.get('/system/general')
      setHostname(res.data.hostname)
      setTimezone(res.data.timezone)
      setTimezones(res.data.available_timezones || [])
    } catch (err) {
      setError('Failed to load general settings')
    } finally {
      setGeneralLoading(false)
    }
  }

  const saveGeneral = async () => {
    setGeneralSaving(true)
    setGeneralMsg('')
    setError('')
    try {
      await api.put('/system/general', { hostname, timezone })
      setGeneralMsg('Settings saved')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save settings')
    } finally {
      setGeneralSaving(false)
    }
  }

  const loadNtp = async () => {
    setNtpLoading(true)
    try {
      const res = await api.get('/system/ntp')
      setNtpServers(res.data)
    } catch (err) {
      setError('Failed to load NTP servers')
    } finally {
      setNtpLoading(false)
    }
  }

  const addNtp = async (e) => {
    e.preventDefault()
    if (!ntpAddress) return
    setError('')
    try {
      await api.post('/system/ntp', { address: ntpAddress, iburst: ntpIburst, prefer: ntpPrefer })
      setNtpAddress('')
      setNtpIburst(true)
      setNtpPrefer(false)
      loadNtp()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add NTP server')
    }
  }

  const removeNtp = async (address) => {
    setError('')
    try {
      await api.delete(`/system/ntp/${encodeURIComponent(address)}`)
      loadNtp()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remove NTP server')
    }
  }

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
    setMigErrors([])
    try {
      const form = new FormData()
      form.append('file', migFile)
      form.append('user_passwords', JSON.stringify(userPasswords))
      form.append('import_users', importUsers)
      form.append('import_smb_shares', importSmbShares)
      const res = await api.post('/migrate/truenas/apply', form)
      setMigResult(res.data)
      if (res.data.errors?.length) setMigErrors(res.data.errors)
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

  const load2faStatus = async () => {
    setTfaLoading(true)
    try {
      const res = await api.get('/auth/2fa/status')
      setTfaEnabled(res.data.enabled)
    } catch (err) {
      setError('Failed to load 2FA status')
    } finally {
      setTfaLoading(false)
    }
  }

  const setup2fa = async () => {
    setError('')
    setTfaMsg('')
    try {
      const res = await api.post('/auth/2fa/setup')
      setTfaSetup(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to setup 2FA')
    }
  }

  const enable2fa = async (e) => {
    e.preventDefault()
    setError('')
    setTfaMsg('')
    try {
      await api.post('/auth/2fa/enable', { code: tfaCode })
      setTfaEnabled(true)
      setTfaSetup(null)
      setTfaCode('')
      setTfaMsg('2FA enabled successfully')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to enable 2FA')
    }
  }

  const disable2fa = async (e) => {
    e.preventDefault()
    setError('')
    setTfaMsg('')
    try {
      await api.post('/auth/2fa/disable', { code: tfaDisableCode })
      setTfaEnabled(false)
      setTfaDisableCode('')
      setTfaMsg('2FA disabled')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to disable 2FA')
    }
  }

  const handlePower = async (action) => {
    setPowerConfirm(null)
    setPowerMsg('')
    setError('')
    try {
      await api.post(`/system/${action}`)
      setPowerMsg(action === 'reboot' ? 'Reboot initiated — the system will be unavailable shortly.' : 'Shutdown initiated — the system will power off shortly.')
    } catch (err) {
      setError(err.response?.data?.detail || `Failed to ${action}`)
    }
  }

  const tabLabels = {
    general: 'General',
    ntp: 'NTP Servers',
    migrate: 'TrueNAS Import',
    backup: 'Config Backup',
    audit: 'Audit Log',
    security: 'Security',
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Settings</h2>

      <div className="flex gap-2 mb-6 flex-wrap">
        {Object.entries(tabLabels).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key)
              setError('')
              if (key === 'ntp' && ntpServers.length === 0) loadNtp()
              if (key === 'audit' && !auditLog) loadAuditLog()
              if (key === 'security') load2faStatus()
            }}
            className={`px-4 py-2 text-sm rounded ${tab === key ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {/* General */}
      {tab === 'general' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-4">General Settings</h3>
            {generalLoading ? (
              <div className="text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
            ) : (
              <div className="space-y-4 max-w-lg">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Hostname</label>
                  <input
                    type="text"
                    value={hostname}
                    onChange={e => setHostname(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Timezone</label>
                  <select
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {timezones.map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={saveGeneral}
                  disabled={generalSaving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {generalSaving ? 'Saving...' : 'Save'}
                </button>
                {generalMsg && <div className="text-sm text-green-600">{generalMsg}</div>}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-2">Power</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Reboot or shut down the host system. All connections will be lost.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setPowerConfirm('reboot')}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded hover:bg-amber-700"
              >
                Reboot
              </button>
              <button
                onClick={() => setPowerConfirm('shutdown')}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Shut Down
              </button>
            </div>
            {powerMsg && <div className="mt-3 text-sm text-amber-600 dark:text-amber-400">{powerMsg}</div>}
          </div>
        </div>
      )}

      {powerConfirm && (
        <ConfirmDialog
          title={powerConfirm === 'reboot' ? 'Reboot System' : 'Shut Down System'}
          message={powerConfirm === 'reboot'
            ? 'Are you sure you want to reboot? All active connections and services will be interrupted.'
            : 'Are you sure you want to shut down? The system will power off and must be physically turned back on.'}
          confirmText={powerConfirm === 'reboot' ? 'Reboot' : 'Shut Down'}
          danger={true}
          onConfirm={() => handlePower(powerConfirm)}
          onCancel={() => setPowerConfirm(null)}
        />
      )}

      {/* NTP */}
      {tab === 'ntp' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">NTP Servers</h3>
              <button onClick={loadNtp} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Refresh</button>
            </div>
            {ntpLoading ? (
              <div className="p-4 text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Address</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">IBurst</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Prefer</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ntpServers.map(s => (
                    <tr key={s.address} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-2 font-mono">{s.address}</td>
                      <td className="px-4 py-2">{s.iburst ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-2">{s.prefer ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => removeNtp(s.address)}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {ntpServers.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400 dark:text-gray-500">No NTP servers configured</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-4">Add NTP Server</h3>
            <form onSubmit={addNtp} className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Address</label>
                <input
                  type="text"
                  value={ntpAddress}
                  onChange={e => setNtpAddress(e.target.value)}
                  placeholder="pool.ntp.org"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={ntpIburst} onChange={e => setNtpIburst(e.target.checked)} />
                IBurst
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={ntpPrefer} onChange={e => setNtpPrefer(e.target.checked)} />
                Prefer
              </label>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TrueNAS Import */}
      {tab === 'migrate' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-2">Import TrueNAS Config</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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
              <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400 rounded text-sm">
                <p className="font-medium mb-1">Migration applied successfully!</p>
                <ul className="list-disc list-inside">
                  {migResult.imported?.users != null && <li>Users created: {migResult.imported.users}{migResult.imported.users_skipped ? ` (${migResult.imported.users_skipped} skipped)` : ''}</li>}
                  {migResult.imported?.smb_shares != null && <li>SMB shares created: {migResult.imported.smb_shares}{migResult.imported.smb_shares_skipped ? ` (${migResult.imported.smb_shares_skipped} skipped)` : ''}</li>}
                  {migResult.imported?.snapshot_policies != null && <li>Snapshot policies: {migResult.imported.snapshot_policies}</li>}
                  {migResult.imported?.scrub_tasks != null && <li>Scrub tasks: {migResult.imported.scrub_tasks}</li>}
                  {migResult.imported?.cloud_sync_tasks != null && <li>Cloud sync tasks: {migResult.imported.cloud_sync_tasks}</li>}
                </ul>
              </div>
            )}
            {migErrors.length > 0 && (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400 rounded text-sm mt-2">
                <p className="font-medium mb-1">Warnings:</p>
                <ul className="list-disc list-inside">
                  {migErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>

          {preview && (
            <div className="space-y-4">
              {/* Users */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    Users ({(preview.users || []).filter(u => u.uid >= 1000).length})
                  </h4>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={importUsers} onChange={e => setImportUsers(e.target.checked)} />
                    Import users
                  </label>
                </div>
                {importUsers && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Set a password for each user to create their system and SMB accounts. Users without a password will be created with a locked account.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                      <th className="pb-2 pr-4">Username</th><th className="pb-2 pr-4">UID</th><th className="pb-2 pr-4">GID</th>
                      <th className="pb-2 pr-4">Full Name</th>
                      <th className="pb-2 pr-4">SMB</th>
                      <th className="pb-2 pr-4">Groups</th>
                      {importUsers && <th className="pb-2">Password</th>}
                    </tr></thead>
                    <tbody>
                      {(preview.users || []).filter(u => !u.builtin && u.uid >= 1000).map(u => (
                        <tr key={u.username} className="border-b dark:border-gray-700 last:border-0">
                          <td className="py-1 pr-4 font-medium">{u.username}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{u.uid}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{u.gid}</td>
                          <td className="py-1 pr-4 text-xs text-gray-500 dark:text-gray-400">{u.full_name || '-'}</td>
                          <td className="py-1 pr-4 text-xs">{u.has_smb ? 'Yes' : '-'}</td>
                          <td className="py-1 pr-4 text-xs text-gray-500 dark:text-gray-400">{(u.groups || []).join(', ') || '-'}</td>
                          {importUsers && (
                            <td className="py-1">
                              <input
                                type="password"
                                placeholder="Set password (min 8)"
                                value={userPasswords[u.username] || ''}
                                onChange={e => setUserPasswords(prev => ({...prev, [u.username]: e.target.value}))}
                                className="border dark:border-gray-600 rounded px-2 py-1 text-xs w-40 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SMB Shares */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    SMB Shares ({preview.smb_shares?.length || 0})
                  </h4>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={importSmbShares} onChange={e => setImportSmbShares(e.target.checked)} />
                    Import SMB shares
                  </label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                      <th className="pb-2 pr-4">Name</th><th className="pb-2 pr-4">Path</th><th className="pb-2 pr-4">Comment</th>
                      <th className="pb-2 pr-4">Read Only</th><th className="pb-2 pr-4">Guest</th><th className="pb-2">Options</th>
                    </tr></thead>
                    <tbody>
                      {(preview.smb_shares || []).map(s => (
                        <tr key={s.name} className="border-b dark:border-gray-700 last:border-0">
                          <td className="py-1 pr-4 font-medium">{s.name}{s.is_home && <span className="ml-1 text-xs text-blue-500" title="Will be imported as Samba [homes] share">[homes]</span>}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{s.path}</td>
                          <td className="py-1 pr-4 text-gray-500 dark:text-gray-400">{s.comment || '-'}</td>
                          <td className="py-1 pr-4 text-xs">{s.read_only ? 'Yes' : 'No'}</td>
                          <td className="py-1 pr-4 text-xs">{s.guest_ok ? 'Yes' : 'No'}</td>
                          <td className="py-1 text-xs text-gray-500 dark:text-gray-400">
                            {[s.recycle_bin && 'Recycle', s.time_machine && 'TimeMachine'].filter(Boolean).join(', ') || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* NFS Exports */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">
                  NFS Exports ({preview.nfs_exports?.length || 0})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                      <th className="pb-2 pr-4">Paths</th><th className="pb-2 pr-4">Hosts</th><th className="pb-2">Map Root</th>
                    </tr></thead>
                    <tbody>
                      {(preview.nfs_exports || []).map(e => (
                        <tr key={e.id} className="border-b dark:border-gray-700 last:border-0">
                          <td className="py-1 pr-4 font-mono text-xs">{e.paths}</td>
                          <td className="py-1 pr-4 text-xs">{e.hosts || '*'}</td>
                          <td className="py-1 text-xs text-gray-500 dark:text-gray-400">{e.maproot_user || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cloud Sync */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">
                  Cloud Sync Tasks ({preview.cloud_sync_tasks?.length || 0})
                </h4>
                {preview.cloud_sync_tasks?.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Cloud credentials are encrypted in the TrueNAS export and must be re-entered after import.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                      <th className="pb-2 pr-4">Description</th><th className="pb-2 pr-4">Provider</th><th className="pb-2 pr-4">Direction</th><th className="pb-2 pr-4">Mode</th><th className="pb-2 pr-4">Path</th><th className="pb-2">Schedule</th>
                    </tr></thead>
                    <tbody>
                      {(preview.cloud_sync_tasks || []).map((t, i) => (
                        <tr key={i} className="border-b dark:border-gray-700 last:border-0">
                          <td className="py-1 pr-4 font-medium">
                            {t.description}
                            {!t.enabled && <span className="ml-1 text-xs text-gray-400">(disabled)</span>}
                          </td>
                          <td className="py-1 pr-4 text-xs">
                            {t.credential_provider || '-'}
                            {t.credential_name && <span className="text-gray-400 ml-1">({t.credential_name})</span>}
                          </td>
                          <td className="py-1 pr-4">{t.direction}</td>
                          <td className="py-1 pr-4 text-xs">{t.transfer_mode}</td>
                          <td className="py-1 pr-4 font-mono text-xs">{t.path}</td>
                          <td className="py-1 font-mono text-xs">{t.schedule}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Scrub Tasks */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
                <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-2">Export Config</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Download a backup of all snapshot policies, tasks, settings, smb.conf, and /etc/exports.
            </p>
            <button onClick={exportConfig} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              Download Config Backup
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-2">Import Config</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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
              <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400 rounded text-sm">
                Imported: {JSON.stringify(importResult.imported)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audit Log */}
      {tab === 'audit' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Audit Log</h3>
            <button onClick={loadAuditLog} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Refresh</button>
          </div>
          {auditLoading ? (
            <div className="p-4 text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Time</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">User</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Action</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Resource</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">IP</th>
                </tr>
              </thead>
              <tbody>
                {(auditLog || []).map(entry => (
                  <tr key={entry.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{entry.timestamp}</td>
                    <td className="px-4 py-2">{entry.username}</td>
                    <td className="px-4 py-2"><span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{entry.action}</span></td>
                    <td className="px-4 py-2 font-mono text-xs">{entry.resource}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{entry.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Security (2FA) */}
      {tab === 'security' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
          <h3 className="text-lg font-semibold mb-4">Two-Factor Authentication</h3>
          {tfaLoading ? (
            <div className="text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
          ) : tfaEnabled ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">2FA Active</span>
              </div>
              <form onSubmit={disable2fa} className="max-w-sm">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Enter OTP code to disable 2FA</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tfaDisableCode}
                    onChange={e => setTfaDisableCode(e.target.value)}
                    placeholder="123456"
                    maxLength={6}
                    className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <button type="submit" className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700">
                    Disable 2FA
                  </button>
                </div>
              </form>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                If you lose your authenticator, you'll need server-side access to disable 2FA.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {!tfaSetup ? (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Add an extra layer of security to your account with a TOTP authenticator app.
                  </p>
                  <button onClick={setup2fa} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                    Enable 2FA
                  </button>
                </div>
              ) : (
                <div className="space-y-4 max-w-md">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Scan this QR code with your authenticator app:</p>
                  <div className="bg-white border rounded p-4 inline-block [&_svg]:w-48 [&_svg]:h-48" dangerouslySetInnerHTML={{ __html: tfaSetup.qr_svg }} />
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Or enter this secret manually:</p>
                    <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded select-all">{tfaSetup.secret}</code>
                  </div>
                  <form onSubmit={enable2fa}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Verification code</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tfaCode}
                        onChange={e => setTfaCode(e.target.value)}
                        placeholder="123456"
                        maxLength={6}
                        className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                      <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">
                        Verify & Enable
                      </button>
                    </div>
                  </form>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    If you lose your authenticator, you'll need server-side access to disable 2FA.
                  </p>
                </div>
              )}
            </div>
          )}
          {tfaMsg && <div className="mt-4 text-sm text-green-600">{tfaMsg}</div>}
        </div>
      )}
    </div>
  )
}
