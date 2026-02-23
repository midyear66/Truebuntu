import { useState, useEffect } from 'react'
import api from '../api'

export default function Users() {
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('users')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', uid: '', smb_user: true })
  const [showGroupCreate, setShowGroupCreate] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', gid: '' })
  const [error, setError] = useState('')

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

  if (loading) return <div className="text-gray-500">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Users & Groups</h2>
        <div className="flex gap-2">
          <button onClick={() => setTab('users')} className={`px-3 py-1 text-sm rounded ${tab === 'users' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
            Users ({users.length})
          </button>
          <button onClick={() => setTab('groups')} className={`px-3 py-1 text-sm rounded ${tab === 'groups' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
            Groups ({groups.length})
          </button>
        </div>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {tab === 'users' && (
        <>
          <div className="mb-4">
            <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              Create User
            </button>
          </div>

          {showCreate && (
            <form onSubmit={createUser} className="bg-white rounded-lg shadow p-5 mb-6">
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

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Username</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">UID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">GID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Home</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Shell</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.username} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{u.username}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.uid}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.gid}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{u.home}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{u.shell}</td>
                    <td className="px-4 py-3 text-right">
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
            <form onSubmit={createGroup} className="bg-white rounded-lg shadow p-5 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <input type="text" value={groupForm.name} onChange={e => setGroupForm({...groupForm, name: e.target.value})} placeholder="Group name" className="border rounded px-3 py-2 text-sm" required />
                <input type="text" value={groupForm.gid} onChange={e => setGroupForm({...groupForm, gid: e.target.value})} placeholder="GID (optional)" className="border rounded px-3 py-2 text-sm" />
              </div>
              <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
            </form>
          )}

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Group</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">GID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Members</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.name} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{g.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{g.gid}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{g.members.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
