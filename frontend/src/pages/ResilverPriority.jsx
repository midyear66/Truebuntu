import { useState, useEffect } from 'react'
import api from '../api'

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

export default function ResilverPriority() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/resilver')
      setConfig(res.data)
    } catch (err) {
      setError('Failed to load resilver config')
    } finally {
      setLoading(false)
    }
  }

  const toggleWeekday = (day) => {
    setConfig(prev => {
      const weekdays = prev.weekdays.includes(day)
        ? prev.weekdays.filter(d => d !== day)
        : [...prev.weekdays, day].sort()
      return { ...prev, weekdays }
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await api.put('/resilver', {
        enabled: config.enabled,
        begin_hour: config.begin_hour,
        begin_minute: config.begin_minute,
        end_hour: config.end_hour,
        end_minute: config.end_minute,
        weekdays: config.weekdays,
      })
      setSuccess('Resilver priority saved')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>
  if (!config) return <div className="text-red-500">Failed to load config</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Resilver Priority</h2>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 max-w-2xl">
        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig({...config, enabled: e.target.checked})} />
            Enable resilver priority schedule
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">When enabled, ZFS resilvering will be given higher priority during the specified time window.</p>
        </div>

        {config.current_delay !== null && (
          <div className="mb-6 p-3 bg-gray-50 dark:bg-gray-700 rounded text-sm">
            Current resilver delay: <span className="font-mono font-medium">{config.current_delay}</span>
            <span className="text-gray-500 dark:text-gray-400 ml-2">(lower = higher priority, 0 = no throttling)</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Begin Time</label>
            <div className="flex gap-2">
              <select value={config.begin_hour} onChange={e => setConfig({...config, begin_hour: parseInt(e.target.value)})} className="border rounded px-3 py-2 text-sm">
                {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
              </select>
              <span className="self-center">:</span>
              <select value={config.begin_minute} onChange={e => setConfig({...config, begin_minute: parseInt(e.target.value)})} className="border rounded px-3 py-2 text-sm">
                {MINUTES.map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">End Time</label>
            <div className="flex gap-2">
              <select value={config.end_hour} onChange={e => setConfig({...config, end_hour: parseInt(e.target.value)})} className="border rounded px-3 py-2 text-sm">
                {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
              </select>
              <span className="self-center">:</span>
              <select value={config.end_minute} onChange={e => setConfig({...config, end_minute: parseInt(e.target.value)})} className="border rounded px-3 py-2 text-sm">
                {MINUTES.map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Weekdays</label>
          <div className="flex gap-2">
            {WEEKDAY_NAMES.map((name, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(i + 1)}
                className={`px-3 py-1.5 text-sm rounded border ${
                  config.weekdays.includes(i + 1)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  )
}
