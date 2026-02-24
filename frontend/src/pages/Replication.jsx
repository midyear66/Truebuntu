import { useState, useEffect } from 'react'
import api from '../api'
import useJobPoller from '../useJobPoller'

export default function Replication() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({
    name: '', source_dataset: '', destination_host: '', destination_port: 22,
    destination_user: 'root', destination_dataset: '', recursive: false,
    incremental: true, ssh_key_path: '', schedule: '0 0 * * *', enabled: true,
  })
  const [error, setError] = useState('')
  const { submitJob, cancelJob, getJobForResource } = useJobPoller()

  const load = async () => {
    try {
      const res = await api.get('/replication')
      setTasks(res.data)
    } catch (err) {
      setError('Failed to load replication tasks')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({
      name: '', source_dataset: '', destination_host: '', destination_port: 22,
      destination_user: 'root', destination_dataset: '', recursive: false,
      incremental: true, ssh_key_path: '', schedule: '0 0 * * *', enabled: true,
    })
    setShowCreate(false)
    setEditId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editId) {
        await api.put(`/replication/${editId}`, form)
      } else {
        await api.post('/replication', form)
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const startEdit = (t) => {
    setForm({
      name: t.name, source_dataset: t.source_dataset, destination_host: t.destination_host,
      destination_port: t.destination_port, destination_user: t.destination_user,
      destination_dataset: t.destination_dataset, recursive: !!t.recursive,
      incremental: !!t.incremental, ssh_key_path: t.ssh_key_path,
      schedule: t.schedule, enabled: !!t.enabled,
    })
    setEditId(t.id)
    setShowCreate(true)
  }

  const runTask = async (id) => {
    try {
      await submitJob(() => api.post(`/replication/${id}/run`))
    } catch (err) {
      if (err.response?.status === 409) {
        setError('This replication task is already running')
      } else {
        setError(err.response?.data?.detail || 'Run failed')
      }
    }
  }

  const deleteTask = async (id) => {
    if (!confirm('Delete this replication task?')) return
    try {
      await api.delete(`/replication/${id}`)
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
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">ZFS Replication</h2>
        <button onClick={() => { if (showCreate) resetForm(); else setShowCreate(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showCreate ? 'Cancel' : 'Add Replication Task'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Task name" className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <input type="text" value={form.source_dataset} onChange={e => setForm({...form, source_dataset: e.target.value})} placeholder="Source dataset (e.g. tank/data)" className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <input type="text" value={form.destination_host} onChange={e => setForm({...form, destination_host: e.target.value})} placeholder="Destination host" className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <input type="text" value={form.destination_dataset} onChange={e => setForm({...form, destination_dataset: e.target.value})} placeholder="Destination dataset" className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <input type="text" value={form.destination_user} onChange={e => setForm({...form, destination_user: e.target.value})} placeholder="SSH user" className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
            <input type="number" value={form.destination_port} onChange={e => setForm({...form, destination_port: parseInt(e.target.value) || 22})} placeholder="SSH port" className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
            <input type="text" value={form.ssh_key_path} onChange={e => setForm({...form, ssh_key_path: e.target.value})} placeholder="SSH key path (optional)" className="border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
            <input type="text" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} placeholder="Cron schedule" className="border dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" />
          </div>
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.recursive} onChange={e => setForm({...form, recursive: e.target.checked})} /> Recursive</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.incremental} onChange={e => setForm({...form, incremental: e.target.checked})} /> Incremental</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({...form, enabled: e.target.checked})} /> Enabled</label>
          </div>
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">
            {editId ? 'Update' : 'Create'}
          </button>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Source</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Destination</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Last Run</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Last Snapshot</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map(t => (
              <tr key={t.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{t.source_dataset}</td>
                <td className="px-4 py-3 font-mono text-xs">{t.destination_host}:{t.destination_dataset}</td>
                <td className="px-4 py-3 font-mono text-xs">{t.schedule}</td>
                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{t.last_run || 'Never'}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{t.last_snapshot || 'None'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${t.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {t.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {getJobForResource(`replication:${t.id}`) ? (
                    <button onClick={() => cancelJob(getJobForResource(`replication:${t.id}`).id)} className="text-red-600 hover:text-red-800 text-xs">
                      Running... Cancel
                    </button>
                  ) : (
                    <button onClick={() => runTask(t.id)} className="text-blue-600 hover:text-blue-800 text-xs">Run</button>
                  )}
                  <button onClick={() => startEdit(t)} className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 text-xs">Edit</button>
                  <button onClick={() => deleteTask(t.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
