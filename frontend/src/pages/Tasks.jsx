import { useState, useEffect } from 'react'
import api from '../api'
import useJobPoller from '../useJobPoller'

export default function Tasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'scrub', schedule: '0 0 * * 0', config: {} })
  const [configStr, setConfigStr] = useState('{}')
  const [error, setError] = useState('')
  const { submitJob, cancelJob, getJobForResource } = useJobPoller()

  const load = async () => {
    try {
      const res = await api.get('/tasks')
      setTasks(res.data)
    } catch (err) {
      setError('Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  const createTask = async (e) => {
    e.preventDefault()
    try {
      const config = JSON.parse(configStr)
      await api.post('/tasks', { ...form, config })
      setShowCreate(false)
      setForm({ name: '', type: 'scrub', schedule: '0 0 * * 0', config: {} })
      setConfigStr('{}')
      load()
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Create failed')
    }
  }

  const runTask = async (id) => {
    try {
      await submitJob(() => api.post(`/tasks/${id}/run`))
    } catch (err) {
      if (err.response?.status === 409) {
        setError('This task is already running')
      } else {
        setError(err.response?.data?.detail || 'Run failed')
      }
    }
  }

  const deleteTask = async (id) => {
    if (!confirm('Delete this task?')) return
    try {
      await api.delete(`/tasks/${id}`)
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
        <h2 className="text-2xl font-bold text-gray-800">Scheduled Tasks</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Create Task
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={createTask} className="bg-white rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Task name" className="border rounded px-3 py-2 text-sm" required />
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="border rounded px-3 py-2 text-sm">
              <option value="scrub">ZFS Scrub</option>
              <option value="smart_test">SMART Test</option>
              <option value="rclone_sync">rclone Sync</option>
              <option value="rsync">rsync</option>
            </select>
            <input type="text" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} placeholder="Cron schedule" className="border rounded px-3 py-2 text-sm" />
            <input type="text" value={configStr} onChange={e => setConfigStr(e.target.value)} placeholder='Config JSON (e.g. {"pool":"testpool"})' className="border rounded px-3 py-2 text-sm font-mono" />
          </div>
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Run</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map(t => (
              <tr key={t.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{t.type}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{t.schedule || '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{t.last_run || 'Never'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${t.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {t.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {getJobForResource(`task:${t.id}`) ? (
                    <button onClick={() => cancelJob(getJobForResource(`task:${t.id}`).id)} className="text-red-600 hover:text-red-800 text-xs">
                      Running... Cancel
                    </button>
                  ) : (
                    <button onClick={() => runTask(t.id)} className="text-blue-600 hover:text-blue-800 text-xs">Run Now</button>
                  )}
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
