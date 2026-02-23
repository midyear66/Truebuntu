import { useState, useEffect } from 'react'
import api from '../api'

export default function CloudSync() {
  const [remotes, setRemotes] = useState([])
  const [selectedRemote, setSelectedRemote] = useState(null)
  const [remoteDetail, setRemoteDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'b2', config: { account: '', key: '' } })
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(null)

  const load = async () => {
    try {
      const res = await api.get('/rclone/remotes')
      setRemotes(res.data)
    } catch (err) {
      setError('Failed to load remotes')
    } finally {
      setLoading(false)
    }
  }

  const viewRemote = async (name) => {
    setSelectedRemote(name)
    try {
      const res = await api.get(`/rclone/remotes/${name}`)
      setRemoteDetail(res.data)
    } catch (err) {
      setRemoteDetail(null)
    }
  }

  const createRemote = async (e) => {
    e.preventDefault()
    try {
      await api.post('/rclone/remotes', form)
      setShowCreate(false)
      setForm({ name: '', type: 'b2', config: { account: '', key: '' } })
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteRemote = async (name) => {
    if (!confirm(`Delete remote "${name}"?`)) return
    try {
      await api.delete(`/rclone/remotes/${name}`)
      if (selectedRemote === name) {
        setSelectedRemote(null)
        setRemoteDetail(null)
      }
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  const testRemote = async (name) => {
    setTesting(name)
    try {
      const res = await api.post(`/rclone/remotes/${name}/test`)
      alert(res.data.success ? 'Connection successful!' : `Failed: ${res.data.error}`)
    } catch (err) {
      alert('Test failed')
    } finally {
      setTesting(null)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Cloud Sync (rclone)</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Add Remote
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={createRemote} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Remote name" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
              <option value="b2">Backblaze B2</option>
              <option value="s3">Amazon S3</option>
              <option value="sftp">SFTP</option>
              <option value="local">Local</option>
            </select>
            <input type="text" value={form.config.account || ''} onChange={e => setForm({...form, config: {...form.config, account: e.target.value}})} placeholder="Account / Access Key" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
            <input type="password" value={form.config.key || ''} onChange={e => setForm({...form, config: {...form.config, key: e.target.value}})} placeholder="Key / Secret" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
          </div>
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create Remote</button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          {remotes.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 dark:text-gray-500">No remotes configured</div>
          ) : remotes.map(name => (
            <div key={name} className={`p-4 border-b dark:border-gray-700 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedRemote === name ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`} onClick={() => viewRemote(name)}>
              <span className="font-medium">{name}</span>
              <div className="flex gap-2">
                <button onClick={(e) => { e.stopPropagation(); testRemote(name) }} disabled={testing === name} className="text-blue-600 hover:text-blue-800 text-xs">
                  {testing === name ? 'Testing...' : 'Test'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteRemote(name) }} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
              </div>
            </div>
          ))}
        </div>

        {remoteDetail && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold mb-3">{remoteDetail.name}</h3>
            <div className="space-y-2">
              {Object.entries(remoteDetail.config).map(([k, v]) => (
                <div key={k} className="flex">
                  <span className="text-sm text-gray-500 dark:text-gray-400 w-32">{k}</span>
                  <span className="text-sm font-mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
