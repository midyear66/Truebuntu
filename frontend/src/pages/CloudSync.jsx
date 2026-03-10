import { useState, useEffect } from 'react'
import api from '../api'
import useJobPoller from '../useJobPoller'

const EMPTY_TASK = {
  name: '',
  direction: 'PUSH',
  transfer_mode: 'SYNC',
  credential_name: '',
  bucket_folder: '',
  local_path: '',
  schedule: '0 0 * * *',
  enabled: true,
  follow_symlinks: false,
  transfers: '',
  bwlimit: '',
  exclude: '',
  pre_script: '',
  post_script: '',
}

export default function CloudSync() {
  // Remotes state
  const [remotes, setRemotes] = useState([])
  const [selectedRemote, setSelectedRemote] = useState(null)
  const [remoteDetail, setRemoteDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateRemote, setShowCreateRemote] = useState(false)
  const [remoteForm, setRemoteForm] = useState({ name: '', type: 'b2', config: { account: '', key: '' } })
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(null)

  // Tasks state
  const [tasks, setTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [taskForm, setTaskForm] = useState({ ...EMPTY_TASK })
  const { submitJob, cancelJob, getJobForResource } = useJobPoller()

  const loadRemotes = async () => {
    try {
      const res = await api.get('/rclone/remotes')
      setRemotes(res.data)
    } catch (err) {
      setError('Failed to load remotes')
    } finally {
      setLoading(false)
    }
  }

  const loadTasks = async () => {
    try {
      const res = await api.get('/tasks')
      setTasks(res.data.filter(t => t.type === 'rclone_sync'))
    } catch (err) {
      setError('Failed to load tasks')
    } finally {
      setTasksLoading(false)
    }
  }

  useEffect(() => { loadRemotes(); loadTasks() }, [])

  // Remote CRUD
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
      await api.post('/rclone/remotes', remoteForm)
      setShowCreateRemote(false)
      setRemoteForm({ name: '', type: 'b2', config: { account: '', key: '' } })
      loadRemotes()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteRemote = async (name) => {
    if (!confirm(`Delete remote "${name}"?`)) return
    try {
      await api.delete(`/rclone/remotes/${name}`)
      if (selectedRemote === name) { setSelectedRemote(null); setRemoteDetail(null) }
      loadRemotes()
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

  // Task CRUD
  const openCreateTask = () => {
    setEditingTaskId(null)
    setTaskForm({ ...EMPTY_TASK })
    setShowTaskForm(true)
  }

  const openEditTask = (task) => {
    const c = task.config || {}
    setEditingTaskId(task.id)
    setTaskForm({
      name: task.name || '',
      direction: c.direction || 'PUSH',
      transfer_mode: c.transfer_mode || 'SYNC',
      credential_name: c.credential_name || '',
      bucket_folder: c.bucket_folder || '',
      local_path: c.local_path || c.source || '',
      schedule: task.schedule || '0 0 * * *',
      enabled: task.enabled !== false && task.enabled !== 0,
      follow_symlinks: !!c.follow_symlinks,
      transfers: c.transfers != null ? String(c.transfers) : '',
      bwlimit: c.bwlimit || '',
      exclude: Array.isArray(c.exclude) ? c.exclude.join('\n') : '',
      pre_script: c.pre_script || '',
      post_script: c.post_script || '',
    })
    setShowTaskForm(true)
  }

  const submitTask = async (e) => {
    e.preventDefault()
    setError('')
    const config = {
      direction: taskForm.direction,
      transfer_mode: taskForm.transfer_mode,
      credential_name: taskForm.credential_name,
      bucket_folder: taskForm.bucket_folder,
      local_path: taskForm.local_path,
      follow_symlinks: taskForm.follow_symlinks,
    }
    if (taskForm.transfers) config.transfers = parseInt(taskForm.transfers) || null
    if (taskForm.bwlimit) config.bwlimit = taskForm.bwlimit
    const excludeLines = taskForm.exclude.split('\n').map(s => s.trim()).filter(Boolean)
    if (excludeLines.length) config.exclude = excludeLines
    if (taskForm.pre_script) config.pre_script = taskForm.pre_script
    if (taskForm.post_script) config.post_script = taskForm.post_script

    try {
      if (editingTaskId) {
        await api.put(`/tasks/${editingTaskId}`, {
          name: taskForm.name,
          schedule: taskForm.schedule,
          config,
          enabled: taskForm.enabled,
        })
      } else {
        await api.post('/tasks', {
          name: taskForm.name,
          type: 'rclone_sync',
          schedule: taskForm.schedule,
          config,
          enabled: taskForm.enabled,
        })
      }
      setShowTaskForm(false)
      setEditingTaskId(null)
      setTaskForm({ ...EMPTY_TASK })
      loadTasks()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const runTask = async (id) => {
    try {
      await submitJob(() => api.post(`/tasks/${id}/run`))
    } catch (err) {
      if (err.response?.status === 409) setError('Task is already running')
      else setError(err.response?.data?.detail || 'Run failed')
    }
  }

  const deleteTask = async (id) => {
    if (!confirm('Delete this cloud sync task?')) return
    try {
      await api.delete(`/tasks/${id}`)
      loadTasks()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  const tf = (field, value) => setTaskForm(prev => ({ ...prev, [field]: value }))

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Cloud Sync (rclone)</h2>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {/* Cloud Sync Tasks */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Cloud Sync Tasks</h3>
          <button onClick={openCreateTask} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Add Task
          </button>
        </div>

        {showTaskForm && (
          <form onSubmit={submitTask} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-4">
            <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-4">
              {editingTaskId ? 'Edit Task' : 'New Cloud Sync Task'}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Name</label>
                <input type="text" value={taskForm.name} onChange={e => tf('name', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Direction</label>
                <select value={taskForm.direction} onChange={e => tf('direction', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
                  <option value="PUSH">PUSH — Send to cloud</option>
                  <option value="PULL">PULL — Receive from cloud</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Transfer Mode</label>
                <select value={taskForm.transfer_mode} onChange={e => tf('transfer_mode', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
                  <option value="SYNC">SYNC — Mirror source to destination</option>
                  <option value="COPY">COPY — Copy files, don't delete</option>
                  <option value="MOVE">MOVE — Move files, delete from source</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Remote</label>
                <select value={taskForm.credential_name} onChange={e => tf('credential_name', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required>
                  <option value="">Select a remote...</option>
                  {remotes.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Bucket / Folder</label>
                <input type="text" value={taskForm.bucket_folder} onChange={e => tf('bucket_folder', e.target.value)}
                  placeholder="bucket-name/path" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Local Path</label>
                <input type="text" value={taskForm.local_path} onChange={e => tf('local_path', e.target.value)}
                  placeholder="/mnt/pool/dataset" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Schedule (cron)</label>
                <input type="text" value={taskForm.schedule} onChange={e => tf('schedule', e.target.value)}
                  placeholder="0 0 * * *" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Bandwidth Limit</label>
                <input type="text" value={taskForm.bwlimit} onChange={e => tf('bwlimit', e.target.value)}
                  placeholder="e.g. 1M, 500k" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Transfers</label>
                <input type="number" value={taskForm.transfers} onChange={e => tf('transfers', e.target.value)}
                  placeholder="4" min="1" max="64" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Exclude Patterns (one per line)</label>
              <textarea value={taskForm.exclude} onChange={e => tf('exclude', e.target.value)} rows={3}
                placeholder={"*.tmp\n.Thumbs.db"} className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Pre-script</label>
                <textarea value={taskForm.pre_script} onChange={e => tf('pre_script', e.target.value)} rows={2}
                  placeholder="Script to run before sync" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Post-script</label>
                <textarea value={taskForm.post_script} onChange={e => tf('post_script', e.target.value)} rows={2}
                  placeholder="Script to run after sync" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:text-gray-100" />
              </div>
            </div>

            <div className="flex items-center gap-6 mb-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={taskForm.enabled} onChange={e => tf('enabled', e.target.checked)} />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={taskForm.follow_symlinks} onChange={e => tf('follow_symlinks', e.target.checked)} />
                Follow Symlinks
              </label>
            </div>

            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">
                {editingTaskId ? 'Update Task' : 'Create Task'}
              </button>
              <button type="button" onClick={() => { setShowTaskForm(false); setEditingTaskId(null) }}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          {tasksLoading ? (
            <div className="p-4 text-sm text-gray-400 dark:text-gray-500">Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 dark:text-gray-500">No cloud sync tasks configured</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Direction</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Mode</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Remote</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Path</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Schedule</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Last Run</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => {
                  const c = t.config || {}
                  const job = getJobForResource(`task:${t.id}`)
                  return (
                    <tr key={t.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 font-medium">{t.name}</td>
                      <td className="px-4 py-2 text-xs">{c.direction || '-'}</td>
                      <td className="px-4 py-2 text-xs">{c.transfer_mode || '-'}</td>
                      <td className="px-4 py-2 text-xs">{c.credential_name || c.dest || '-'}</td>
                      <td className="px-4 py-2 font-mono text-xs">{c.local_path || c.source || '-'}</td>
                      <td className="px-4 py-2 font-mono text-xs">{t.schedule || '-'}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{t.last_run || 'Never'}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${t.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                          {t.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                        {job ? (
                          <button onClick={() => cancelJob(job.id)} className="text-red-600 hover:text-red-800 text-xs">Running... Cancel</button>
                        ) : (
                          <button onClick={() => runTask(t.id)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">Run Now</button>
                        )}
                        <button onClick={() => openEditTask(t)} className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 text-xs">Edit</button>
                        <button onClick={() => deleteTask(t.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Remotes */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Remotes</h3>
          <button onClick={() => setShowCreateRemote(!showCreateRemote)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Add Remote
          </button>
        </div>

        {showCreateRemote && (
          <form onSubmit={createRemote} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <input type="text" value={remoteForm.name} onChange={e => setRemoteForm({...remoteForm, name: e.target.value})} placeholder="Remote name" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
              <select value={remoteForm.type} onChange={e => setRemoteForm({...remoteForm, type: e.target.value})} className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
                <option value="b2">Backblaze B2</option>
                <option value="s3">Amazon S3</option>
                <option value="sftp">SFTP</option>
                <option value="local">Local</option>
              </select>
              <input type="text" value={remoteForm.config.account || ''} onChange={e => setRemoteForm({...remoteForm, config: {...remoteForm.config, account: e.target.value}})} placeholder="Account / Access Key" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
              <input type="password" value={remoteForm.config.key || ''} onChange={e => setRemoteForm({...remoteForm, config: {...remoteForm.config, key: e.target.value}})} placeholder="Key / Secret" className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
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
                  <button onClick={(e) => { e.stopPropagation(); testRemote(name) }} disabled={testing === name} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">
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
    </div>
  )
}
