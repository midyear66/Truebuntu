import { useState, useEffect } from 'react'
import api from '../api'

export default function NFS() {
  const [exports, setExports] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ path: '', host: '*', options: 'rw,sync,no_subtree_check' })
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/nfs')
      setExports(res.data)
    } catch (err) {
      setError('Failed to load NFS exports')
    } finally {
      setLoading(false)
    }
  }

  const createExport = async (e) => {
    e.preventDefault()
    try {
      await api.post('/nfs', {
        path: form.path,
        clients: [{ host: form.host, options: form.options }],
      })
      setForm({ path: '', host: '*', options: 'rw,sync,no_subtree_check' })
      setShowCreate(false)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteExport = async (path) => {
    if (!confirm(`Delete NFS export "${path}"?`)) return
    try {
      // Strip leading / for URL path param
      await api.delete(`/nfs/${path.replace(/^\//, '')}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  const reloadExports = async () => {
    try {
      await api.post('/nfs/reload')
    } catch (err) {
      setError('Reload failed')
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">NFS Exports</h2>
        <div className="flex gap-2">
          <button onClick={reloadExports} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
            Reload
          </button>
          <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Add Export
          </button>
        </div>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={createExport} className="bg-white rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input type="text" value={form.path} onChange={e => setForm({...form, path: e.target.value})} placeholder="Export path" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={form.host} onChange={e => setForm({...form, host: e.target.value})} placeholder="Host/network" className="border rounded px-3 py-2 text-sm" />
            <input type="text" value={form.options} onChange={e => setForm({...form, options: e.target.value})} placeholder="Options" className="border rounded px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Add Export</button>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Path</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Clients</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {exports.map((exp, i) => (
              <tr key={i} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{exp.path}</td>
                <td className="px-4 py-3">
                  {exp.clients.map((c, j) => (
                    <span key={j} className="inline-block mr-2 text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {c.host}({c.options})
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => deleteExport(exp.path)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
