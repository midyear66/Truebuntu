import { useState, useEffect } from 'react'
import api from '../api'

export default function InitShutdown() {
  const [scripts, setScripts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', type: 'init', when_run: 'post', command: '', timeout: 30, enabled: true })
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/init-shutdown')
      setScripts(res.data)
    } catch (err) {
      setError('Failed to load scripts')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({ name: '', type: 'init', when_run: 'post', command: '', timeout: 30, enabled: true })
    setShowCreate(false)
    setEditId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editId) {
        await api.put(`/init-shutdown/${editId}`, form)
      } else {
        await api.post('/init-shutdown', form)
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const startEdit = (s) => {
    setForm({ name: s.name, type: s.type, when_run: s.when_run, command: s.command, timeout: s.timeout, enabled: !!s.enabled })
    setEditId(s.id)
    setShowCreate(true)
  }

  const runScript = async (id) => {
    try {
      const res = await api.post(`/init-shutdown/${id}/run`)
      alert(res.data.result || 'Script executed')
    } catch (err) {
      setError(err.response?.data?.detail || 'Run failed')
    }
  }

  const deleteScript = async (id) => {
    if (!confirm('Delete this script?')) return
    try {
      await api.delete(`/init-shutdown/${id}`)
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
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Init/Shutdown Scripts</h2>
        <button onClick={() => { if (showCreate) resetForm(); else setShowCreate(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showCreate ? 'Cancel' : 'Add Script'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Script name" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
              <option value="init">Init (Startup)</option>
              <option value="shutdown">Shutdown</option>
            </select>
            <select value={form.when_run} onChange={e => setForm({...form, when_run: e.target.value})} className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
              <option value="pre">Pre</option>
              <option value="post">Post</option>
            </select>
            <input type="number" value={form.timeout} onChange={e => setForm({...form, timeout: parseInt(e.target.value) || 30})} placeholder="Timeout (seconds)" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
          </div>
          <textarea value={form.command} onChange={e => setForm({...form, command: e.target.value})} placeholder="Command to execute" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono mb-3 dark:bg-gray-700 dark:text-gray-100" rows={3} required />
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

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">When</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Command</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Timeout</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {scripts.map(s => (
              <tr key={s.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${s.type === 'init' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                    {s.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${s.when_run === 'pre' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'}`}>
                    {s.when_run}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs max-w-xs truncate">{s.command}</td>
                <td className="px-4 py-3 text-xs">{s.timeout}s</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${s.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {s.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => runScript(s.id)} className="text-blue-600 hover:text-blue-800 text-xs">Run</button>
                  <button onClick={() => startEdit(s)} className="text-gray-600 dark:text-gray-300 hover:text-gray-800 text-xs">Edit</button>
                  <button onClick={() => deleteScript(s.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
