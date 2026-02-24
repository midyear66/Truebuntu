import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

export default function FTPConfig() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [installed, setInstalled] = useState(true)
  const [form, setForm] = useState({
    listen_port: 21,
    max_clients: 200,
    max_per_ip: 0,
    idle_session_timeout: 300,
    anonymous_enable: false,
    local_enable: true,
    write_enable: true,
    chroot_local_user: true,
    ssl_enable: false,
    allow_writeable_chroot: true,
    pasv_min_port: 0,
    pasv_max_port: 0,
    local_umask: '022',
  })

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/ftp/config')
        setInstalled(res.data.installed)
        if (res.data.config) setForm(res.data.config)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load FTP configuration')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await api.put('/ftp/config', form)
      setSuccess('FTP configuration saved')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  const inputClass = "w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
  const labelClass = "block text-xs text-gray-500 dark:text-gray-400 mb-1"
  const sectionClass = "bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3"
  const sectionTitle = "text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 uppercase tracking-wide"

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/services')} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">FTP Configuration</h2>
      </div>

      {!installed && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 text-sm rounded">
          vsftpd is not installed. Install it with <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">apt install vsftpd</code> to enable FTP.
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        <div className={sectionClass}>
          <h3 className={sectionTitle}>General</h3>
          <div>
            <label className={labelClass}>Listen Port</label>
            <input type="number" value={form.listen_port} onChange={e => setForm({ ...form, listen_port: parseInt(e.target.value) || 21 })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Max Clients</label>
            <input type="number" value={form.max_clients} onChange={e => setForm({ ...form, max_clients: parseInt(e.target.value) || 0 })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Max Connections Per IP (0 = unlimited)</label>
            <input type="number" value={form.max_per_ip} onChange={e => setForm({ ...form, max_per_ip: parseInt(e.target.value) || 0 })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Idle Session Timeout (seconds)</label>
            <input type="number" value={form.idle_session_timeout} onChange={e => setForm({ ...form, idle_session_timeout: parseInt(e.target.value) || 300 })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Local Umask</label>
            <input type="text" value={form.local_umask} onChange={e => setForm({ ...form, local_umask: e.target.value })} className={inputClass} placeholder="022" />
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>Access</h3>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.anonymous_enable} onChange={e => setForm({ ...form, anonymous_enable: e.target.checked })} className="rounded" />
            Allow Anonymous Login
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.local_enable} onChange={e => setForm({ ...form, local_enable: e.target.checked })} className="rounded" />
            Allow Local User Login
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.write_enable} onChange={e => setForm({ ...form, write_enable: e.target.checked })} className="rounded" />
            Allow Write
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.chroot_local_user} onChange={e => setForm({ ...form, chroot_local_user: e.target.checked })} className="rounded" />
            Chroot Local Users
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.allow_writeable_chroot} onChange={e => setForm({ ...form, allow_writeable_chroot: e.target.checked })} className="rounded" />
            Allow Writeable Chroot
          </label>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>TLS</h3>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.ssl_enable} onChange={e => setForm({ ...form, ssl_enable: e.target.checked })} className="rounded" />
            Enable SSL/TLS
          </label>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>Passive Mode</h3>
          <div>
            <label className={labelClass}>PASV Min Port (0 = any)</label>
            <input type="number" value={form.pasv_min_port} onChange={e => setForm({ ...form, pasv_min_port: parseInt(e.target.value) || 0 })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>PASV Max Port (0 = any)</label>
            <input type="number" value={form.pasv_max_port} onChange={e => setForm({ ...form, pasv_max_port: parseInt(e.target.value) || 0 })} className={inputClass} />
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={saving || !installed} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
