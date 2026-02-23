import { useState, useEffect } from 'react'
import api from '../api'

export default function SnapshotTasks() {
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({
    name: '', dataset: '', schedule: '0 * * * *', retention_count: 10,
    retention_unit: 'count', naming_schema: 'auto-%Y-%m-%d_%H-%M',
    recursive: false, exclude: '[]', enabled: true,
  })
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/snapshot-policies')
      setPolicies(res.data)
    } catch (err) {
      setError('Failed to load snapshot policies')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({
      name: '', dataset: '', schedule: '0 * * * *', retention_count: 10,
      retention_unit: 'count', naming_schema: 'auto-%Y-%m-%d_%H-%M',
      recursive: false, exclude: '[]', enabled: true,
    })
    setShowForm(false)
    setEditId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const payload = { ...form, recursive: form.recursive ? 1 : 0, enabled: form.enabled ? 1 : 0 }
      if (editId) {
        await api.put(`/snapshot-policies/${editId}`, payload)
      } else {
        await api.post('/snapshot-policies', payload)
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const startEdit = (p) => {
    setForm({
      name: p.name, dataset: p.dataset, schedule: p.schedule,
      retention_count: p.retention_count, retention_unit: p.retention_unit || 'count',
      naming_schema: p.naming_schema || 'auto-%Y-%m-%d_%H-%M',
      recursive: !!p.recursive, exclude: p.exclude || '[]', enabled: !!p.enabled,
    })
    setEditId(p.id)
    setShowForm(true)
  }

  const deletePolicy = async (id) => {
    if (!confirm('Delete this snapshot policy?')) return
    try {
      await api.delete(`/snapshot-policies/${id}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Periodic Snapshot Tasks</h2>
        <button onClick={() => { if (showForm) resetForm(); else setShowForm(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showForm ? 'Cancel' : 'Add Policy'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Policy name" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <input type="text" value={form.dataset} onChange={e => setForm({...form, dataset: e.target.value})} placeholder="Dataset (e.g. testpool/data)" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <input type="text" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} placeholder="Cron schedule (e.g. 0 * * * *)" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" required />
            <input type="number" value={form.retention_count} onChange={e => setForm({...form, retention_count: parseInt(e.target.value) || 1})} placeholder="Retention count" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
            <select value={form.retention_unit} onChange={e => setForm({...form, retention_unit: e.target.value})} className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
              <option value="count">Count</option>
              <option value="hour">Hours</option>
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
            </select>
            <input type="text" value={form.naming_schema} onChange={e => setForm({...form, naming_schema: e.target.value})} placeholder="Naming schema" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" />
            <input type="text" value={form.exclude} onChange={e => setForm({...form, exclude: e.target.value})} placeholder='Exclude (JSON array, e.g. ["child1"])' className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.recursive} onChange={e => setForm({...form, recursive: e.target.checked})} /> Recursive</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({...form, enabled: e.target.checked})} /> Enabled</label>
            <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">
              {editId ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Dataset</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Retention</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Recursive</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {policies.map(p => (
              <tr key={p.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.dataset}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.schedule}</td>
                <td className="px-4 py-3">{p.retention_count} {p.retention_unit !== 'count' ? p.retention_unit : ''}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.recursive ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {p.recursive ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => startEdit(p)} className="text-gray-600 dark:text-gray-300 hover:text-gray-800 text-xs">Edit</button>
                  <button onClick={() => deletePolicy(p.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
