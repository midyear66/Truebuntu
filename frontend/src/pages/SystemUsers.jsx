import { useState, useEffect } from 'react'
import api from '../api'

export default function SystemUsers() {
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('users')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', uid: '', smb_user: true })
  const [showGroupCreate, setShowGroupCreate] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', gid: '' })
  const [error, setError] = useState('')
  const [pwTarget, setPwTarget] = useState(null)
  const [newPw, setNewPw] = useState('')

  const load = async () => {
    try {
      const [uRes, gRes] = await Promise.all([
        api.get('/users'),
        api.get('/users/groups'),
      ])
      setUsers(uRes.data)
      setGroups(gRes.data)
    } catch (err) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const createUser = async (e) => {
    e.preventDefault()
    try {
      await api.post('/users', {
        ...form,
        uid: form.uid ? parseInt(form.uid) : undefined,
      })
      setShowCreate(false)
      setForm({ username: '', password: '', uid: '', smb_user: true })
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const changeUserPw = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/users/${pwTarget}/password`, { password: newPw })
      setPwTarget(null)
      setNewPw('')
      setError('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Password change failed')
    }
  }

  const deleteUser = async (username) => {
    if (!confirm(`Delete user "${username}"?`)) return
    try {
      await api.delete(`/users/${username}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  const createGroup = async (e) => {
    e.preventDefault()
    try {
      await api.post('/users/groups', {
        name: groupForm.name,
        gid: groupForm.gid ? parseInt(groupForm.gid) : undefined,
      })
      setShowGroupCreate(false)
      setGroupForm({ name: '', gid: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">System Users & Groups</h2>
        <div className="flex gap-2">
          <button onClick={() => setTab('users')} className={`px-3 py-1 text-sm rounded ${tab === 'users' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'}`}>
            Users ({users.length})
          </button>
          <button onClick={() => setTab('groups')} className={`px-3 py-1 text-sm rounded ${tab === 'groups' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'}`}>
            Groups ({groups.length})
          </button>
        </div>
      </div>

      {tab === 'users' && (
        <>
          <div className="mb-4">
            <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              Create User
            </button>
          </div>

          {showCreate && (
            <form onSubmit={createUser} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <input type="text" value={form.username} onChange={e => setForm({...form, username: e.target.value})} placeholder="Username" className="border rounded px-3 py-2 text-sm" required />
                <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="Password (min 8 chars)" className="border rounded px-3 py-2 text-sm" required />
                <input type="text" value={form.uid} onChange={e => setForm({...form, uid: e.target.value})} placeholder="UID (optional)" className="border rounded px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.smb_user} onChange={e => setForm({...form, smb_user: e.target.checked})} />
                  Also create Samba account
                </label>
              </div>
              <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
            </form>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Username</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">UID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">GID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Home</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Shell</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.username} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-medium">{u.username}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.uid}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.gid}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{u.home}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{u.shell}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => { setPwTarget(u.username); setNewPw('') }} className="text-blue-600 hover:text-blue-800 text-xs">Password</button>
                      <button onClick={() => deleteUser(u.username)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'groups' && (
        <>
          <div className="mb-4">
            <button onClick={() => setShowGroupCreate(!showGroupCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              Create Group
            </button>
          </div>

          {showGroupCreate && (
            <form onSubmit={createGroup} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <input type="text" value={groupForm.name} onChange={e => setGroupForm({...groupForm, name: e.target.value})} placeholder="Group name" className="border rounded px-3 py-2 text-sm" required />
                <input type="text" value={groupForm.gid} onChange={e => setGroupForm({...groupForm, gid: e.target.value})} placeholder="GID (optional)" className="border rounded px-3 py-2 text-sm" />
              </div>
              <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
            </form>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Group</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">GID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Members</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-medium">{g.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{g.gid}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{g.members.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* System user password modal */}
      {pwTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={changeUserPw} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Change Password for {pwTarget}</h3>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New password (min 8 chars)" className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 mb-4" required minLength={8} />
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
