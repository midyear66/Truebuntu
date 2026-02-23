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

  if (loading) return <div className="text-gray-500">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Periodic Snapshot Tasks</h2>
        <button onClick={() => { if (showForm) resetForm(); else setShowForm(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showForm ? 'Cancel' : 'Add Policy'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Policy name" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={form.dataset} onChange={e => setForm({...form, dataset: e.target.value})} placeholder="Dataset (e.g. testpool/data)" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} placeholder="Cron schedule (e.g. 0 * * * *)" className="border rounded px-3 py-2 text-sm font-mono" required />
            <input type="number" value={form.retention_count} onChange={e => setForm({...form, retention_count: parseInt(e.target.value) || 1})} placeholder="Retention count" className="border rounded px-3 py-2 text-sm" />
            <select value={form.retention_unit} onChange={e => setForm({...form, retention_unit: e.target.value})} className="border rounded px-3 py-2 text-sm">
              <option value="count">Count</option>
              <option value="hour">Hours</option>
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
            </select>
            <input type="text" value={form.naming_schema} onChange={e => setForm({...form, naming_schema: e.target.value})} placeholder="Naming schema" className="border rounded px-3 py-2 text-sm font-mono" />
            <input type="text" value={form.exclude} onChange={e => setForm({...form, exclude: e.target.value})} placeholder='Exclude (JSON array, e.g. ["child1"])' className="border rounded px-3 py-2 text-sm font-mono" />
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

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Dataset</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Retention</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Recursive</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {policies.map(p => (
              <tr key={p.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.dataset}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.schedule}</td>
                <td className="px-4 py-3">{p.retention_count} {p.retention_unit !== 'count' ? p.retention_unit : ''}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.recursive ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                    {p.recursive ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => startEdit(p)} className="text-gray-600 hover:text-gray-800 text-xs">Edit</button>
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
