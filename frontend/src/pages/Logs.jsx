import { useState, useEffect, useRef } from 'react'
import api from '../api'

const PRIORITIES = [
  { value: '', label: 'All Priorities' },
  { value: '0', label: '0 - Emergency' },
  { value: '1', label: '1 - Alert' },
  { value: '2', label: '2 - Critical' },
  { value: '3', label: '3 - Error' },
  { value: '4', label: '4 - Warning' },
  { value: '5', label: '5 - Notice' },
  { value: '6', label: '6 - Info' },
  { value: '7', label: '7 - Debug' },
]

const PRIORITY_COLORS = {
  '0': 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
  '1': 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
  '2': 'text-red-500 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
  '3': 'text-red-500',
  '4': 'text-yellow-600',
  '5': 'text-blue-600',
  '6': 'text-gray-700',
  '7': 'text-gray-400',
}

const formatTimestamp = (us) => {
  if (!us) return ''
  const ms = parseInt(us) / 1000
  return new Date(ms).toLocaleString()
}

export default function Logs() {
  const [entries, setEntries] = useState([])
  const [units, setUnits] = useState([])
  const [unit, setUnit] = useState('')
  const [priority, setPriority] = useState('')
  const [lines, setLines] = useState(100)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const intervalRef = useRef(null)

  const loadLogs = async () => {
    try {
      const params = new URLSearchParams()
      if (unit) params.set('unit', unit)
      if (priority) params.set('priority', priority)
      params.set('lines', lines)
      const res = await api.get(`/logs?${params}`)
      setEntries(res.data)
    } catch (err) {
      console.error('Failed to load logs:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadUnits = async () => {
    try {
      const res = await api.get('/logs/units')
      setUnits(res.data)
    } catch (err) {
      console.error('Failed to load units:', err)
    }
  }

  useEffect(() => {
    loadLogs()
    loadUnits()
  }, [])

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(loadLogs, 5000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, unit, priority, lines])

  const handleFilter = () => {
    setLoading(true)
    loadLogs()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">System Logs</h2>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select value={unit} onChange={e => setUnit(e.target.value)} className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
            <option value="">All Units</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value)} className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select value={lines} onChange={e => setLines(parseInt(e.target.value))} className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
            <option value={50}>50 lines</option>
            <option value={100}>100 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
            <option value={1000}>1000 lines</option>
          </select>
          <button onClick={handleFilter} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Refresh
          </button>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (5s)
          </label>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400">Loading logs...</div>
      ) : (
        <div className="bg-gray-900 rounded-lg shadow overflow-auto max-h-[70vh]">
          <div className="p-4 font-mono text-xs leading-relaxed">
            {entries.length === 0 ? (
              <div className="text-gray-400">No log entries found</div>
            ) : entries.map((entry, i) => (
              <div key={i} className={`py-0.5 ${PRIORITY_COLORS[String(entry.priority)] || 'text-gray-300'}`}>
                <span className="text-gray-500">{formatTimestamp(entry.timestamp)}</span>
                {' '}
                <span className="text-cyan-400">{entry.unit}</span>
                {entry.pid && <span className="text-gray-500">[{entry.pid}]</span>}
                {': '}
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
