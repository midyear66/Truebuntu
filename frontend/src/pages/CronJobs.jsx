import { useState, useEffect } from 'react'
import api from '../api'

export default function CronJobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', command: '', schedule: '0 * * * *', user: 'root', description: '', enabled: true })
  const [running, setRunning] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/cron-jobs')
      setJobs(res.data)
    } catch (err) {
      setError('Failed to load cron jobs')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({ name: '', command: '', schedule: '0 * * * *', user: 'root', description: '', enabled: true })
    setShowCreate(false)
    setEditId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editId) {
        await api.put(`/cron-jobs/${editId}`, form)
      } else {
        await api.post('/cron-jobs', form)
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const startEdit = (job) => {
    setForm({ name: job.name, command: job.command, schedule: job.schedule, user: job.user, description: job.description, enabled: !!job.enabled })
    setEditId(job.id)
    setShowCreate(true)
  }

  const runJob = async (id) => {
    setRunning(id)
    try {
      const res = await api.post(`/cron-jobs/${id}/run`)
      alert(res.data.result || 'Job executed')
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Run failed')
    } finally {
      setRunning(null)
    }
  }

  const deleteJob = async (id) => {
    if (!confirm('Delete this cron job?')) return
    try {
      await api.delete(`/cron-jobs/${id}`)
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
        <h2 className="text-2xl font-bold text-gray-800">Cron Jobs</h2>
        <button onClick={() => { if (showCreate) resetForm(); else setShowCreate(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showCreate ? 'Cancel' : 'Add Cron Job'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Job name" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} placeholder="Cron schedule (e.g. 0 * * * *)" className="border rounded px-3 py-2 text-sm font-mono" required />
            <input type="text" value={form.user} onChange={e => setForm({...form, user: e.target.value})} placeholder="Run as user" className="border rounded px-3 py-2 text-sm" />
            <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Description (optional)" className="border rounded px-3 py-2 text-sm" />
          </div>
          <textarea value={form.command} onChange={e => setForm({...form, command: e.target.value})} placeholder="Command to execute" className="w-full border rounded px-3 py-2 text-sm font-mono mb-3" rows={3} required />
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
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Command</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Run</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => (
              <tr key={j.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{j.name}</td>
                <td className="px-4 py-3 font-mono text-xs max-w-xs truncate">{j.command}</td>
                <td className="px-4 py-3 font-mono text-xs">{j.schedule}</td>
                <td className="px-4 py-3 text-xs">{j.user}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{j.last_run || 'Never'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${j.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {j.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => runJob(j.id)} disabled={running === j.id} className="text-blue-600 hover:text-blue-800 text-xs">
                    {running === j.id ? 'Running...' : 'Run'}
                  </button>
                  <button onClick={() => startEdit(j)} className="text-gray-600 hover:text-gray-800 text-xs">Edit</button>
                  <button onClick={() => deleteJob(j.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
