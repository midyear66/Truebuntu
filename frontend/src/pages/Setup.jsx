import { useState } from 'react'
import api from '../api'

export default function Setup({ onSetup }) {
  const [username, setUsername] = useState('admin')
  const [claimToken, setClaimToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/setup', { username, password, claim_token: claimToken })
      onSetup(username)
    } catch (err) {
      setError(err.response?.data?.detail || 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2 text-center">Truebuntu</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">Create your admin account</p>
        <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 text-xs rounded">
          This server prints a one-time setup token to its log. Retrieve it by running{' '}
          <code className="font-mono bg-blue-100 dark:bg-blue-900/40 px-1 py-0.5 rounded">docker compose logs truebuntu</code>{' '}
          on the server, then paste it below. It stops anyone else on the network claiming this
          appliance before you do.
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Setup token</label>
            <input
              type="text"
              value={claimToken}
              onChange={e => setClaimToken(e.target.value)}
              autoComplete="off"
              spellCheck="false"
              placeholder="from the server log"
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? 'Creating...' : 'Create Admin Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
