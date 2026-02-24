import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

export default function UPSConfig() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [installed, setInstalled] = useState(true)
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState({
    mode: 'standalone',
    driver: 'usbhid-ups',
    port: 'auto',
    ups_name: 'ups',
    monitor_host: 'localhost',
    monitor_user: 'upsmon',
    monitor_password: 'secret',
    shutdown_cmd: '/sbin/shutdown -h +0',
    powerdown_flag: '/etc/killpower',
  })

  useEffect(() => {
    const load = async () => {
      try {
        const [configRes, statusRes] = await Promise.all([
          api.get('/ups/config'),
          api.get('/ups/status'),
        ])
        setInstalled(configRes.data.installed)
        if (configRes.data.config) setForm(configRes.data.config)
        if (statusRes.data.status) setStatus(statusRes.data.status)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load UPS configuration')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const refreshStatus = async () => {
    try {
      const res = await api.get('/ups/status')
      if (res.data.status) setStatus(res.data.status)
    } catch {}
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await api.put('/ups/config', form)
      setSuccess('UPS configuration saved')
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
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">UPS Configuration</h2>
      </div>

      {!installed && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 text-sm rounded">
          NUT is not installed. Install it with <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">apt install nut</code> to enable UPS monitoring.
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      {/* Live Status Card */}
      {installed && status && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className={sectionTitle + " mb-0"}>UPS Status</h3>
            <button onClick={refreshStatus} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Status</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.ups_status}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Battery Charge</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.battery_charge}%</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Runtime</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.battery_runtime}s</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Load</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.ups_load}%</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Input Voltage</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.input_voltage}V</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Output Voltage</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.output_voltage}V</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Manufacturer</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.ups_mfr}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Model</div>
              <div className="text-sm font-medium dark:text-gray-100">{status.ups_model}</div>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        <div className={sectionClass}>
          <h3 className={sectionTitle}>UPS Device</h3>
          <div>
            <label className={labelClass}>Mode</label>
            <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className={inputClass}>
              <option value="standalone">Standalone</option>
              <option value="netserver">Net Server</option>
              <option value="netclient">Net Client</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>UPS Name</label>
            <input type="text" value={form.ups_name} onChange={e => setForm({ ...form, ups_name: e.target.value })} className={inputClass} placeholder="ups" />
          </div>
          <div>
            <label className={labelClass}>Driver</label>
            <input type="text" value={form.driver} onChange={e => setForm({ ...form, driver: e.target.value })} className={inputClass} placeholder="usbhid-ups" />
          </div>
          <div>
            <label className={labelClass}>Port</label>
            <input type="text" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} className={inputClass} placeholder="auto" />
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>Monitor</h3>
          <div>
            <label className={labelClass}>Monitor Host</label>
            <input type="text" value={form.monitor_host} onChange={e => setForm({ ...form, monitor_host: e.target.value })} className={inputClass} placeholder="localhost" />
          </div>
          <div>
            <label className={labelClass}>Monitor User</label>
            <input type="text" value={form.monitor_user} onChange={e => setForm({ ...form, monitor_user: e.target.value })} className={inputClass} placeholder="upsmon" />
          </div>
          <div>
            <label className={labelClass}>Monitor Password</label>
            <input type="password" value={form.monitor_password} onChange={e => setForm({ ...form, monitor_password: e.target.value })} className={inputClass} />
          </div>
        </div>

        <div className={sectionClass}>
          <h3 className={sectionTitle}>Shutdown</h3>
          <div>
            <label className={labelClass}>Shutdown Command</label>
            <input type="text" value={form.shutdown_cmd} onChange={e => setForm({ ...form, shutdown_cmd: e.target.value })} className={inputClass} placeholder="/sbin/shutdown -h +0" />
          </div>
          <div>
            <label className={labelClass}>Powerdown Flag</label>
            <input type="text" value={form.powerdown_flag} onChange={e => setForm({ ...form, powerdown_flag: e.target.value })} className={inputClass} placeholder="/etc/killpower" />
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
