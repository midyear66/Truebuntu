import { useState, useEffect } from 'react'
import api from '../api'
import useJobPoller from '../useJobPoller'
import CronPicker from '../components/CronPicker'

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
  const [remotes, setRemotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [buckets, setBuckets] = useState([])
  const [bucketsLoading, setBucketsLoading] = useState(false)
  const [customBucket, setCustomBucket] = useState(false)

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
      // Remotes list is optional — task form dropdown will just be empty
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

  // Task CRUD
  const openCreateTask = () => {
    setEditingTaskId(null)
    setTaskForm({ ...EMPTY_TASK })
    setBuckets([])
    setCustomBucket(false)
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
    if (c.credential_name) loadBuckets(c.credential_name)
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

  const loadBuckets = async (remoteName) => {
    if (!remoteName) { setBuckets([]); return }
    setBucketsLoading(true)
    try {
      const res = await api.get(`/rclone/remotes/${remoteName}/buckets`)
      setBuckets(res.data.buckets || [])
    } catch (err) {
      setBuckets([])
    } finally {
      setBucketsLoading(false)
    }
  }

  const tf = (field, value) => {
    setTaskForm(prev => ({ ...prev, [field]: value }))
    if (field === 'credential_name') {
      setTaskForm(prev => ({ ...prev, credential_name: value, bucket_folder: '' }))
      setCustomBucket(false)
      loadBuckets(value)
    }
  }

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
                {bucketsLoading ? (
                  <div className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm text-gray-400 dark:bg-gray-700">Loading buckets...</div>
                ) : customBucket || buckets.length === 0 ? (
                  <div className="flex gap-1">
                    <input type="text" value={taskForm.bucket_folder} onChange={e => tf('bucket_folder', e.target.value)}
                      placeholder="bucket-name/path" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" />
                    {buckets.length > 0 && (
                      <button type="button" onClick={() => { setCustomBucket(false); tf('bucket_folder', '') }}
                        className="px-2 text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">List</button>
                    )}
                  </div>
                ) : (
                  <select value={taskForm.bucket_folder} onChange={e => {
                    if (e.target.value === '__custom__') { setCustomBucket(true); tf('bucket_folder', '') }
                    else tf('bucket_folder', e.target.value)
                  }} className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100">
                    <option value="">Select a bucket...</option>
                    {buckets.map(b => <option key={b} value={b}>{b}</option>)}
                    <option value="__custom__">Other (enter manually)...</option>
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Local Path</label>
                <input type="text" value={taskForm.local_path} onChange={e => tf('local_path', e.target.value)}
                  placeholder="/mnt/pool/dataset" className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100" required />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Schedule</label>
                <CronPicker value={taskForm.schedule} onChange={v => tf('schedule', v)} />
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

    </div>
  )
}
