import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

export default function SNMPConfig() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [installed, setInstalled] = useState(true)
  const [form, setForm] = useState({
    location: '',
    contact: '',
    community: 'public',
    agent_address: 'udp:161',
    v3_enabled: false,
    v3_username: '',
    v3_auth_type: 'SHA',
    v3_auth_passphrase: '',
    v3_privacy_protocol: 'AES',
    v3_privacy_passphrase: '',
    log_level: '0',
  })

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/snmp/config')
        setInstalled(res.data.installed)
        if (res.data.config) setForm(res.data.config)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load SNMP configuration')
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
      await api.put('/snmp/config', form)
      setSuccess('SNMP configuration saved')
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
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">SNMP Configuration</h2>
      </div>

      {!installed && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 text-sm rounded">
          snmpd is not installed. Install it with <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">apt install snmpd</code> to enable SNMP.
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        <div className={sectionClass}>
          <h3 className={sectionTitle}>General</h3>
          <div>
            <label className={labelClass}>System Location</label>
            <input type="text" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className={inputClass} placeholder="Server Room" />
          </div>
          <div>
            <label className={labelClass}>System Contact</label>
            <input type="text" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className={inputClass} placeholder="admin@example.com" />
          </div>
          <div>
            <label className={labelClass}>Agent Address</label>
            <input type="text" value={form.agent_address} onChange={e => setForm({ ...form, agent_address: e.target.value })} className={inputClass} placeholder="udp:161" />
          </div>
          <div>
            <label className={labelClass}>Log Level</label>
            <select value={form.log_level} onChange={e => setForm({ ...form, log_level: e.target.value })} className={inputClass}>
              <option value="0">Emergency</option>
              <option value="1">Alert</option>
              <option value="2">Critical</option>
              <option value="3">Error</option>
              <option value="4">Warning</option>
              <option value="5">Notice</option>
              <option value="6">Info</option>
              <option value="7">Debug</option>
            </select>
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>SNMPv2c</h3>
          <div>
            <label className={labelClass}>Community String</label>
            <input type="text" value={form.community} onChange={e => setForm({ ...form, community: e.target.value })} className={inputClass} placeholder="public" />
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>SNMPv3</h3>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.v3_enabled} onChange={e => setForm({ ...form, v3_enabled: e.target.checked })} className="rounded" />
            Enable SNMPv3
          </label>
          {form.v3_enabled && (
            <>
              <div>
                <label className={labelClass}>Username</label>
                <input type="text" value={form.v3_username} onChange={e => setForm({ ...form, v3_username: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Authentication Type</label>
                <select value={form.v3_auth_type} onChange={e => setForm({ ...form, v3_auth_type: e.target.value })} className={inputClass}>
                  <option value="MD5">MD5</option>
                  <option value="SHA">SHA</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Authentication Passphrase</label>
                <input type="password" value={form.v3_auth_passphrase} onChange={e => setForm({ ...form, v3_auth_passphrase: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Privacy Protocol</label>
                <select value={form.v3_privacy_protocol} onChange={e => setForm({ ...form, v3_privacy_protocol: e.target.value })} className={inputClass}>
                  <option value="AES">AES</option>
                  <option value="DES">DES</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Privacy Passphrase</label>
                <input type="password" value={form.v3_privacy_passphrase} onChange={e => setForm({ ...form, v3_privacy_passphrase: e.target.value })} className={inputClass} />
              </div>
            </>
          )}
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
