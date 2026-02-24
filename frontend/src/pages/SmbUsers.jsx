import { useState, useEffect } from 'react'
import api from '../api'

export default function SmbUsers() {
  const [smbUsers, setSmbUsers] = useState([])
  const [systemUsers, setSystemUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ username: '', password: '' })
  const [pwTarget, setPwTarget] = useState(null)
  const [newPw, setNewPw] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/smb-users')
      setSmbUsers(res.data.smb_users)
      setSystemUsers(res.data.system_users)
    } catch (err) {
      setError('Failed to load SMB users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const addUser = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/smb-users', form)
      setShowAdd(false)
      setForm({ username: '', password: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add SMB user')
    }
  }

  const removeUser = async (username) => {
    if (!confirm(`Remove Samba account for "${username}"? The system user will not be affected.`)) return
    setError('')
    try {
      await api.delete(`/smb-users/${username}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remove SMB user')
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post(`/smb-users/${pwTarget}/password`, { password: newPw })
      setPwTarget(null)
      setNewPw('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to change password')
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">SMB Users</h2>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="mb-4">
        <button onClick={() => setShowAdd(!showAdd)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Add SMB User
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addUser} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <select
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              required
            >
              <option value="">Select system user...</option>
              {systemUsers.map(u => (
                <option key={u.username} value={u.username}>{u.username} (UID {u.uid})</option>
              ))}
            </select>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="SMB password (min 8 chars)"
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              required
              minLength={8}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Add</button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Username</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">UID</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {smbUsers.map(u => (
              <tr key={u.username} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{u.username}</td>
                <td className="px-4 py-3 font-mono text-xs">{u.uid}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => { setPwTarget(u.username); setNewPw('') }} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">Password</button>
                  <button onClick={() => removeUser(u.username)} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs">Remove</button>
                </td>
              </tr>
            ))}
            {smbUsers.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No Samba users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pwTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={changePassword} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Change SMB Password for {pwTarget}</h3>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="New SMB password (min 8 chars)"
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 mb-4"
              required
              minLength={8}
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setPwTarget(null)} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Change</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
