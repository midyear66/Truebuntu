import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

const PROVIDERS = ['dyndns2', 'cloudflare', 'namecheap', 'google', 'freedns', 'custom']

export default function DynamicDNS() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [installed, setInstalled] = useState(true)
  const [form, setForm] = useState({
    provider: 'dyndns2',
    server: '',
    protocol: 'dyndns2',
    login: '',
    password: '',
    domain: '',
    ssl: true,
    update_interval: 300,
  })

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/ddns/config')
        setInstalled(res.data.installed)
        if (res.data.config) setForm(res.data.config)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load DDNS configuration')
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
      await api.put('/ddns/config', form)
      setSuccess('Dynamic DNS configuration saved')
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
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Dynamic DNS</h2>
      </div>

      {!installed && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 text-sm rounded">
          ddclient is not installed. Install it with <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">apt install ddclient</code> to enable Dynamic DNS.
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        <div className={sectionClass}>
          <h3 className={sectionTitle}>Provider</h3>
          <div>
            <label className={labelClass}>Provider</label>
            <select value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value, protocol: e.target.value })} className={inputClass}>
              {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {form.provider === 'custom' && (
            <div>
              <label className={labelClass}>Server</label>
              <input type="text" value={form.server} onChange={e => setForm({ ...form, server: e.target.value })} className={inputClass} placeholder="members.dyndns.org" />
            </div>
          )}
          <div>
            <label className={labelClass}>Domain</label>
            <input type="text" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} className={inputClass} placeholder="myhost.dyndns.org" />
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>Credentials</h3>
          <div>
            <label className={labelClass}>Login / Username</label>
            <input type="text" value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Password / API Key</label>
            <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className={inputClass} />
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>Options</h3>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.ssl} onChange={e => setForm({ ...form, ssl: e.target.checked })} className="rounded" />
            Use SSL
          </label>
          <div>
            <label className={labelClass}>Update Interval (seconds)</label>
            <input type="number" value={form.update_interval} onChange={e => setForm({ ...form, update_interval: parseInt(e.target.value) || 300 })} className={inputClass} min="60" />
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
