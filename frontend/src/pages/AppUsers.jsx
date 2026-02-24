import { useState, useEffect } from 'react'
import api from '../api'

export default function AppUsers({ isAdmin, currentUser }) {
  const [appUsers, setAppUsers] = useState([])
  const [showAppCreate, setShowAppCreate] = useState(false)
  const [appForm, setAppForm] = useState({ username: '', password: '', is_admin: false })
  const [appPwTarget, setAppPwTarget] = useState(null)
  const [appNewPw, setAppNewPw] = useState('')
  const [error, setError] = useState('')

  const loadAppUsers = async () => {
    try {
      const res = await api.get('/auth/users')
      setAppUsers(res.data)
    } catch (err) {
      // Non-admin or error — just skip
    }
  }

  const createAppUser = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/auth/users', appForm)
      setShowAppCreate(false)
      setAppForm({ username: '', password: '', is_admin: false })
      loadAppUsers()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteAppUser = async (username) => {
    if (!confirm(`Delete app user "${username}"?`)) return
    try {
      await api.delete(`/auth/users/${username}`)
      loadAppUsers()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  const resetAppUserPw = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post(`/auth/users/${appPwTarget}/password`, { password: appNewPw })
      setAppPwTarget(null)
      setAppNewPw('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Password reset failed')
    }
  }

  useEffect(() => {
    if (isAdmin) loadAppUsers()
  }, [isAdmin])

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">App Users</h2>
      </div>

      {isAdmin && (
        <>
          <div className="mb-4">
            <button onClick={() => setShowAppCreate(!showAppCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              Create App User
            </button>
          </div>

          {showAppCreate && (
            <form onSubmit={createAppUser} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <input type="text" value={appForm.username} onChange={e => setAppForm({...appForm, username: e.target.value})} placeholder="Username (min 2 chars)" className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" required minLength={2} />
                <input type="password" value={appForm.password} onChange={e => setAppForm({...appForm, password: e.target.value})} placeholder="Password (min 8 chars)" className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" required minLength={8} />
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={appForm.is_admin} onChange={e => setAppForm({...appForm, is_admin: e.target.checked})} />
                  Admin
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
                <button type="button" onClick={() => setShowAppCreate(false)} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
              </div>
            </form>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Username</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Created</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">2FA</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {appUsers.map(u => (
                  <tr key={u.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{u.username}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${u.is_admin ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-300'}`}>
                        {u.is_admin ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{u.created_at}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${u.totp_enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-400'}`}>
                        {u.totp_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => { setAppPwTarget(u.username); setAppNewPw('') }} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">Reset Password</button>
                      {u.username !== currentUser && (
                        <button onClick={() => deleteAppUser(u.username)} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs">Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
                {appUsers.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No app users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* App user password reset modal */}
      {appPwTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={resetAppUserPw} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Reset Password for {appPwTarget}</h3>
            <input type="password" value={appNewPw} onChange={e => setAppNewPw(e.target.value)} placeholder="New password (min 8 chars)" className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 mb-4" required minLength={8} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setAppPwTarget(null)} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Reset</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
