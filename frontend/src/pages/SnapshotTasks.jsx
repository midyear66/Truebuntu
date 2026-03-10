import { useState, useEffect } from 'react'
import api from '../api'
import CronPicker from '../components/CronPicker'

function excludeToText(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? arr.join(', ') : ''
  } catch {
    return ''
  }
}

function textToExclude(text) {
  const items = text.split(',').map(s => s.trim()).filter(Boolean)
  return JSON.stringify(items)
}

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
const helpCls = 'text-xs text-gray-500 dark:text-gray-400 mt-1'

export default function SnapshotTasks() {
  const [policies, setPolicies] = useState([])
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({
    name: '', dataset: '', schedule: '0 * * * *', retention_count: 10,
    retention_unit: 'count', naming_schema: 'auto-%Y-%m-%d_%H-%M',
    recursive: false, exclude: '', enabled: true, allow_empty: true,
  })
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [polRes, dsRes] = await Promise.all([
        api.get('/snapshot-policies'),
        api.get('/datasets'),
      ])
      setPolicies(polRes.data)
      setDatasets(Array.isArray(dsRes.data) ? dsRes.data : [])
    } catch (err) {
      setError('Failed to load snapshot policies')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({
      name: '', dataset: '', schedule: '0 * * * *', retention_count: 10,
      retention_unit: 'count', naming_schema: 'auto-%Y-%m-%d_%H-%M',
      recursive: false, exclude: '', enabled: true, allow_empty: true,
    })
    setShowForm(false)
    setEditId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        name: form.name,
        dataset: form.dataset,
        schedule: form.schedule,
        retention_count: form.retention_count,
        retention_unit: form.retention_unit,
        naming_schema: form.naming_schema,
        recursive: form.recursive ? 1 : 0,
        exclude: textToExclude(form.exclude),
        enabled: form.enabled ? 1 : 0,
      }
      if (editId) {
        await api.put(`/snapshot-policies/${editId}`, payload)
      } else {
        await api.post('/snapshot-policies', payload)
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Save failed')
    }
  }

  const startEdit = (p) => {
    setForm({
      name: p.name, dataset: p.dataset, schedule: p.schedule,
      retention_count: p.retention_count, retention_unit: p.retention_unit || 'count',
      naming_schema: p.naming_schema || 'auto-%Y-%m-%d_%H-%M',
      recursive: !!p.recursive, exclude: excludeToText(p.exclude),
      enabled: !!p.enabled, allow_empty: true,
    })
    setEditId(p.id)
    setShowForm(true)
  }

  const deletePolicy = async (id) => {
    if (!confirm('Delete this snapshot policy?')) return
    try {
      await api.delete(`/snapshot-policies/${id}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }


  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  const datasetNames = datasets.map(d => d.name || d.id || d)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Periodic Snapshot Tasks</h2>
        <button onClick={() => { if (showForm) resetForm(); else setShowForm(true) }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showForm ? 'Cancel' : 'Add Policy'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          {/* Policy name — full width */}
          <div className="mb-5">
            <label className={labelCls}>Policy Name</label>
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. daily-backup" className={inputCls} required />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left column: Dataset section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 uppercase tracking-wide border-b border-gray-200 dark:border-gray-600 pb-2">Dataset</h3>

              <div>
                <label className={labelCls}>Dataset</label>
                <select value={form.dataset} onChange={e => setForm({...form, dataset: e.target.value})} className={inputCls} required>
                  <option value="">Select a dataset...</option>
                  {datasetNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <p className={helpCls}>The ZFS dataset to snapshot</p>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={form.recursive} onChange={e => setForm({...form, recursive: e.target.checked})} className="rounded" />
                  Recursive
                </label>
                <p className={helpCls}>Include all child datasets in the snapshot</p>
              </div>

              {form.recursive && (
                <div>
                  <label className={labelCls}>Exclude Datasets</label>
                  <input type="text" value={form.exclude} onChange={e => setForm({...form, exclude: e.target.value})} placeholder="dataset1/child1, dataset1/child2" className={inputCls} />
                  <p className={helpCls}>Comma-separated list of child datasets to exclude from recursive snapshots</p>
                </div>
              )}
            </div>

            {/* Right column: Schedule section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 uppercase tracking-wide border-b border-gray-200 dark:border-gray-600 pb-2">Schedule</h3>

              <div>
                <label className={labelCls}>Snapshot Lifetime</label>
                <div className="flex gap-2">
                  <input type="number" min="1" value={form.retention_count} onChange={e => setForm({...form, retention_count: parseInt(e.target.value) || 1})} className={inputCls + ' flex-1'} />
                  <select value={form.retention_unit} onChange={e => setForm({...form, retention_unit: e.target.value})} className={inputCls + ' flex-1'}>
                    <option value="count">Snapshots</option>
                    <option value="hour">Hours</option>
                    <option value="day">Days</option>
                    <option value="week">Weeks</option>
                    <option value="month">Months</option>
                  </select>
                </div>
                <p className={helpCls}>How many snapshots to keep, or how long to retain them</p>
              </div>

              <div>
                <label className={labelCls}>Naming Schema</label>
                <input type="text" value={form.naming_schema} onChange={e => setForm({...form, naming_schema: e.target.value})} placeholder="auto-%Y-%m-%d_%H-%M" className={inputCls + ' font-mono'} />
                <p className={helpCls}>
                  Tokens: %Y (year), %m (month), %d (day), %H (hour), %M (minute)
                  <br />
                  Example: <span className="font-mono">auto-2026-02-24_14-30</span>
                </p>
              </div>

              <div>
                <label className={labelCls}>Schedule</label>
                <CronPicker value={form.schedule} onChange={v => setForm({...form, schedule: v})} />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={form.allow_empty} onChange={e => setForm({...form, allow_empty: e.target.checked})} className="rounded" />
                  Allow Taking Empty Snapshots
                </label>
                <p className={helpCls}>Create snapshots even when no data has changed</p>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm({...form, enabled: e.target.checked})} className="rounded" />
                  Enabled
                </label>
                <p className={helpCls}>Disabled policies will not run on schedule</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button type="submit" className="px-5 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 font-medium">
              {editId ? 'Update Policy' : 'Create Policy'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Dataset</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Retention</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Recursive</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No snapshot policies configured. Click <strong>Add Policy</strong> to create one.
                </td>
              </tr>
            ) : policies.map(p => (
              <tr key={p.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.dataset}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.schedule}</td>
                <td className="px-4 py-3">{p.retention_count} {p.retention_unit !== 'count' ? p.retention_unit : ''}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.recursive ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {p.recursive ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => startEdit(p)} className="text-gray-600 dark:text-gray-300 hover:text-gray-800 text-xs">Edit</button>
                  <button onClick={() => deletePolicy(p.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
