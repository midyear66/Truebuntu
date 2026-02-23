import { useState, useEffect } from 'react'
import api from '../api'

export default function RsyncTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({
    name: '', source: '', destination: '', direction: 'push', mode: 'ssh',
    remote_host: '', remote_port: 22, remote_user: 'root', remote_path: '',
    schedule: '0 0 * * *', extra_args: '', recursive: true, archive: true,
    compress: true, delete_dest: false, enabled: true,
  })
  const [running, setRunning] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/rsync-tasks')
      setTasks(res.data)
    } catch (err) {
      setError('Failed to load rsync tasks')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({
      name: '', source: '', destination: '', direction: 'push', mode: 'ssh',
      remote_host: '', remote_port: 22, remote_user: 'root', remote_path: '',
      schedule: '0 0 * * *', extra_args: '', recursive: true, archive: true,
      compress: true, delete_dest: false, enabled: true,
    })
    setShowCreate(false)
    setEditId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editId) {
        await api.put(`/rsync-tasks/${editId}`, form)
      } else {
        await api.post('/rsync-tasks', form)
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const startEdit = (t) => {
    setForm({
      name: t.name, source: t.source, destination: t.destination, direction: t.direction,
      mode: t.mode, remote_host: t.remote_host, remote_port: t.remote_port,
      remote_user: t.remote_user, remote_path: t.remote_path, schedule: t.schedule,
      extra_args: t.extra_args, recursive: !!t.recursive, archive: !!t.archive,
      compress: !!t.compress, delete_dest: !!t.delete_dest, enabled: !!t.enabled,
    })
    setEditId(t.id)
    setShowCreate(true)
  }

  const runTask = async (id) => {
    setRunning(id)
    try {
      const res = await api.post(`/rsync-tasks/${id}/run`)
      alert(res.data.result || 'Task executed')
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Run failed')
    } finally {
      setRunning(null)
    }
  }

  const deleteTask = async (id) => {
    if (!confirm('Delete this rsync task?')) return
    try {
      await api.delete(`/rsync-tasks/${id}`)
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
        <h2 className="text-2xl font-bold text-gray-800">Rsync Tasks</h2>
        <button onClick={() => { if (showCreate) resetForm(); else setShowCreate(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showCreate ? 'Cancel' : 'Add Rsync Task'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Task name" className="border rounded px-3 py-2 text-sm" required />
            <select value={form.direction} onChange={e => setForm({...form, direction: e.target.value})} className="border rounded px-3 py-2 text-sm">
              <option value="push">Push</option>
              <option value="pull">Pull</option>
            </select>
            <input type="text" value={form.source} onChange={e => setForm({...form, source: e.target.value})} placeholder="Source path" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={form.destination} onChange={e => setForm({...form, destination: e.target.value})} placeholder="Destination path" className="border rounded px-3 py-2 text-sm" required />
            <select value={form.mode} onChange={e => setForm({...form, mode: e.target.value})} className="border rounded px-3 py-2 text-sm">
              <option value="ssh">SSH</option>
              <option value="module">Rsync Module</option>
            </select>
            <input type="text" value={form.remote_host} onChange={e => setForm({...form, remote_host: e.target.value})} placeholder="Remote host" className="border rounded px-3 py-2 text-sm" />
            <input type="number" value={form.remote_port} onChange={e => setForm({...form, remote_port: parseInt(e.target.value) || 22})} placeholder="Remote port" className="border rounded px-3 py-2 text-sm" />
            <input type="text" value={form.remote_user} onChange={e => setForm({...form, remote_user: e.target.value})} placeholder="Remote user" className="border rounded px-3 py-2 text-sm" />
            <input type="text" value={form.remote_path} onChange={e => setForm({...form, remote_path: e.target.value})} placeholder="Remote path" className="border rounded px-3 py-2 text-sm" />
            <input type="text" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} placeholder="Cron schedule" className="border rounded px-3 py-2 text-sm font-mono" />
            <input type="text" value={form.extra_args} onChange={e => setForm({...form, extra_args: e.target.value})} placeholder="Extra arguments (optional)" className="border rounded px-3 py-2 text-sm font-mono" />
          </div>
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.recursive} onChange={e => setForm({...form, recursive: e.target.checked})} /> Recursive</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.archive} onChange={e => setForm({...form, archive: e.target.checked})} /> Archive</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.compress} onChange={e => setForm({...form, compress: e.target.checked})} /> Compress</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.delete_dest} onChange={e => setForm({...form, delete_dest: e.target.checked})} /> Delete destination</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({...form, enabled: e.target.checked})} /> Enabled</label>
          </div>
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">
            {editId ? 'Update' : 'Create'}
          </button>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Source / Dest</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Mode</th>
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
                <td className="px-4 py-3 font-mono text-xs">{t.source} → {t.destination}</td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{t.mode}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{t.schedule}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{t.last_run || 'Never'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${t.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {t.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => runTask(t.id)} disabled={running === t.id} className="text-blue-600 hover:text-blue-800 text-xs">
                    {running === t.id ? 'Running...' : 'Run'}
                  </button>
                  <button onClick={() => startEdit(t)} className="text-gray-600 hover:text-gray-800 text-xs">Edit</button>
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
