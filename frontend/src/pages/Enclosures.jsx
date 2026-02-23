import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'

function TempBadge({ temp }) {
  if (temp === null || temp === undefined) return <span className="text-gray-400 dark:text-gray-500">-</span>
  let color = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  if (temp >= 50) color = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
  else if (temp >= 40) color = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{temp}°C</span>
}

function HealthBadge({ health }) {
  if (health === null || health === undefined) return <span className="text-gray-400 dark:text-gray-500">-</span>
  return health
    ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">PASSED</span>
    : <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">FAILED</span>
}

export default function Enclosures() {
  const [disks, setDisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/enclosure')
        setDisks(res.data.disks || [])
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load enclosure data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Enclosures</h2>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Device</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Model</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Serial</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Size</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Pool</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Temp</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Health</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Power-On Hours</th>
            </tr>
          </thead>
          <tbody>
            {disks.map(d => (
              <tr key={d.device} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-2 font-medium">
                  <Link to="/disks" className="text-blue-600 hover:underline">{d.device}</Link>
                </td>
                <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{d.model || '-'}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{d.serial || '-'}</td>
                <td className="px-4 py-2">{d.size}</td>
                <td className="px-4 py-2">{d.pool || <span className="text-gray-400 dark:text-gray-500">unused</span>}</td>
                <td className="px-4 py-2">{d.role || '-'}</td>
                <td className="px-4 py-2"><TempBadge temp={d.temperature} /></td>
                <td className="px-4 py-2"><HealthBadge health={d.health} /></td>
                <td className="px-4 py-2 font-mono text-xs">{d.power_on_hours != null ? d.power_on_hours.toLocaleString() : '-'}</td>
              </tr>
            ))}
            {disks.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No disks found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
