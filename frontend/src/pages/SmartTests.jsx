import { useState, useEffect } from 'react'
import api from '../api'

export default function SmartTests() {
  const [tests, setTests] = useState([])
  const [availableDisks, setAvailableDisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', disks: [], test_type: 'short', schedule: '0 0 * * 0', enabled: true })
  const [running, setRunning] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [testsRes, disksRes] = await Promise.all([
        api.get('/smart-tests'),
        api.get('/disks'),
      ])
      setTests(testsRes.data)
      setAvailableDisks(disksRes.data)
    } catch (err) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({ name: '', disks: [], test_type: 'short', schedule: '0 0 * * 0', enabled: true })
    setShowCreate(false)
    setEditId(null)
  }

  const toggleDisk = (disk) => {
    setForm(prev => ({
      ...prev,
      disks: prev.disks.includes(disk) ? prev.disks.filter(d => d !== disk) : [...prev.disks, disk],
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editId) {
        await api.put(`/smart-tests/${editId}`, form)
      } else {
        await api.post('/smart-tests', form)
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const startEdit = (t) => {
    setForm({ name: t.name, disks: t.disks || [], test_type: t.test_type, schedule: t.schedule, enabled: !!t.enabled })
    setEditId(t.id)
    setShowCreate(true)
  }

  const runTest = async (id) => {
    setRunning(id)
    try {
      const res = await api.post(`/smart-tests/${id}/run`)
      alert(res.data.result || 'Test started')
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Run failed')
    } finally {
      setRunning(null)
    }
  }

  const deleteTest = async (id) => {
    if (!confirm('Delete this SMART test?')) return
    try {
      await api.delete(`/smart-tests/${id}`)
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
        <h2 className="text-2xl font-bold text-gray-800">S.M.A.R.T. Tests</h2>
        <button onClick={() => { if (showCreate) resetForm(); else setShowCreate(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showCreate ? 'Cancel' : 'Add SMART Test'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Test name" className="border rounded px-3 py-2 text-sm" required />
            <select value={form.test_type} onChange={e => setForm({...form, test_type: e.target.value})} className="border rounded px-3 py-2 text-sm">
              <option value="short">Short</option>
              <option value="long">Long</option>
              <option value="conveyance">Conveyance</option>
              <option value="offline">Offline</option>
            </select>
            <input type="text" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} placeholder="Cron schedule" className="border rounded px-3 py-2 text-sm font-mono" />
          </div>
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">Disks</label>
            <div className="flex flex-wrap gap-2">
              {availableDisks.map(d => (
                <label key={d.name} className="flex items-center gap-1 text-sm bg-gray-50 px-2 py-1 rounded border">
                  <input type="checkbox" checked={form.disks.includes(d.name)} onChange={() => toggleDisk(d.name)} />
                  {d.name} {d.model ? `(${d.model})` : ''} {d.size || ''}
                </label>
              ))}
              {availableDisks.length === 0 && <span className="text-sm text-gray-400">No disks found</span>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm({...form, enabled: e.target.checked})} />
              Enabled
            </label>
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
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Disks</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Run</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {tests.map(t => (
              <tr key={t.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{(t.disks || []).join(', ') || '-'}</td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{t.test_type}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{t.schedule}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{t.last_run || 'Never'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${t.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {t.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => runTest(t.id)} disabled={running === t.id} className="text-blue-600 hover:text-blue-800 text-xs">
                    {running === t.id ? 'Running...' : 'Run'}
                  </button>
                  <button onClick={() => startEdit(t)} className="text-gray-600 hover:text-gray-800 text-xs">Edit</button>
                  <button onClick={() => deleteTest(t.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
