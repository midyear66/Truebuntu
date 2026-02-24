import { useState, useEffect } from 'react'
import api from '../api'

export default function StaticRoutes() {
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [form, setForm] = useState({ destination: '', gateway: '', description: '' })

  useEffect(() => {
    loadRoutes()
  }, [])

  const loadRoutes = async () => {
    try {
      const res = await api.get('/network/static-routes')
      setRoutes(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load static routes')
    } finally {
      setLoading(false)
    }
  }

  const addRoute = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await api.post('/network/static-routes', form)
      setSuccess('Static route added')
      setShowAdd(false)
      setForm({ destination: '', gateway: '', description: '' })
      loadRoutes()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add route')
    } finally {
      setSaving(false)
    }
  }

  const deleteRoute = async (route) => {
    setDeleteConfirm(null)
    setError('')
    setSuccess('')
    try {
      await api.delete('/network/static-routes', { data: { destination: route.destination, gateway: route.gateway } })
      setSuccess('Static route deleted')
      loadRoutes()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete route')
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Static Routes</h2>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <div className="mb-4">
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add Static Route
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addRoute} className="p-4 bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 rounded-lg space-y-3 mb-4 max-w-xl">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Destination (CIDR)</label>
            <input
              type="text"
              value={form.destination}
              onChange={e => setForm({ ...form, destination: e.target.value })}
              placeholder="10.0.0.0/8"
              className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Gateway</label>
            <input
              type="text"
              value={form.gateway}
              onChange={e => setForm({ ...form, gateway: e.target.value })}
              placeholder="192.168.1.1"
              className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Route to internal network"
              className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Route'}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setForm({ destination: '', gateway: '', description: '' }) }} className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Destination</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Gateway</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Description</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => (
              <tr key={i} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-2 font-mono text-xs">{r.destination}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.gateway}</td>
                <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{r.description || '-'}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => setDeleteConfirm(r)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {routes.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No static routes configured</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-sm">
            <p className="text-sm text-gray-700 dark:text-gray-200 mb-4">
              Delete route to <strong>{deleteConfirm.destination}</strong> via <strong>{deleteConfirm.gateway}</strong>? This will apply network changes immediately.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => deleteRoute(deleteConfirm)} className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">
                Delete
              </button>
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
