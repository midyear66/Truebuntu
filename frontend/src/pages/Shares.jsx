import { useState, useEffect } from 'react'
import api from '../api'

export default function Shares() {
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', path: '', comment: '', browseable: 'yes', read_only: 'no', guest_ok: 'no', valid_users: '' })
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/shares')
      setShares(res.data)
    } catch (err) {
      setError('Failed to load shares')
    } finally {
      setLoading(false)
    }
  }

  const createShare = async (e) => {
    e.preventDefault()
    try {
      await api.post('/shares', form)
      setForm({ name: '', path: '', comment: '', browseable: 'yes', read_only: 'no', guest_ok: 'no', valid_users: '' })
      setShowCreate(false)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteShare = async (name) => {
    if (!confirm(`Delete SMB share "${name}"?`)) return
    try {
      await api.delete(`/shares/${name}`)
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
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">SMB Shares</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Create Share
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={createShare} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Share name" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={form.path} onChange={e => setForm({...form, path: e.target.value})} placeholder="Path (e.g. /mnt/testpool/data)" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={form.comment} onChange={e => setForm({...form, comment: e.target.value})} placeholder="Comment" className="border rounded px-3 py-2 text-sm" />
            <input type="text" value={form.valid_users} onChange={e => setForm({...form, valid_users: e.target.value})} placeholder="Valid users (optional)" className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={form.read_only === 'yes'} onChange={e => setForm({...form, read_only: e.target.checked ? 'yes' : 'no'})} />
              Read only
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={form.guest_ok === 'yes'} onChange={e => setForm({...form, guest_ok: e.target.checked ? 'yes' : 'no'})} />
              Guest access
            </label>
          </div>
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Path</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Comment</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Access</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {shares.map(s => (
              <tr key={s.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.path}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.comment || '-'}</td>
                <td className="px-4 py-3">
                  {s['read only'] === 'yes' ? (
                    <span className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 px-2 py-0.5 rounded">Read Only</span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded">Read/Write</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => deleteShare(s.name)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
