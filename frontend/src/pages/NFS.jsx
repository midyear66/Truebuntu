import { useState, useEffect } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'

const CIDR_PREFIXES = ['8', '16', '24', '32']

const DEFAULT_FORM = {
  path: '',
  customPath: false,
  readOnly: false,
  sync: true,
  noSubtreeCheck: true,
  noRootSquash: false,
  mapAllAnon: false,
  anonUid: '',
  anonGid: '',
  networks: [{ address: '', prefix: '24' }],
  hosts: [''],
}

function buildOptionsString(form) {
  const opts = []
  opts.push(form.readOnly ? 'ro' : 'rw')
  opts.push(form.sync ? 'sync' : 'async')
  if (form.noSubtreeCheck) opts.push('no_subtree_check')
  if (form.noRootSquash) opts.push('no_root_squash')
  if (form.mapAllAnon) opts.push('all_squash')
  if (form.anonUid) opts.push(`anonuid=${form.anonUid}`)
  if (form.anonGid) opts.push(`anongid=${form.anonGid}`)
  return opts.join(',')
}

function buildClients(form) {
  const options = buildOptionsString(form)
  const clients = []
  for (const net of form.networks) {
    if (net.address.trim()) {
      clients.push({ host: `${net.address.trim()}/${net.prefix}`, options })
    }
  }
  for (const host of form.hosts) {
    if (host.trim()) {
      clients.push({ host: host.trim(), options })
    }
  }
  if (clients.length === 0) {
    clients.push({ host: '*', options })
  }
  return clients
}

function parseExportToForm(exp) {
  const firstOpts = exp.clients[0]?.options || ''
  const opts = firstOpts.split(',').map(o => o.trim())

  const form = {
    path: exp.path,
    customPath: true,
    readOnly: opts.includes('ro'),
    sync: !opts.includes('async'),
    noSubtreeCheck: opts.includes('no_subtree_check'),
    noRootSquash: opts.includes('no_root_squash'),
    mapAllAnon: opts.includes('all_squash'),
    anonUid: '',
    anonGid: '',
    networks: [],
    hosts: [],
  }

  // Extract anonuid/anongid
  for (const o of opts) {
    if (o.startsWith('anonuid=')) form.anonUid = o.split('=')[1]
    if (o.startsWith('anongid=')) form.anonGid = o.split('=')[1]
  }

  // Classify clients into networks vs hosts
  for (const c of exp.clients) {
    if (c.host === '*') continue
    if (c.host.includes('/')) {
      const [address, prefix] = c.host.split('/')
      form.networks.push({ address, prefix })
    } else {
      form.hosts.push(c.host)
    }
  }

  // Ensure at least one empty row
  if (form.networks.length === 0) form.networks.push({ address: '', prefix: '24' })
  if (form.hosts.length === 0) form.hosts.push('')

  return form
}

function summarizeOptions(options) {
  const opts = options.split(',').map(o => o.trim())
  const parts = []
  parts.push(opts.includes('ro') ? 'RO' : 'RW')
  parts.push(opts.includes('async') ? 'async' : 'sync')
  if (opts.includes('no_root_squash')) parts.push('no_root_squash')
  if (opts.includes('all_squash')) parts.push('all_squash')
  return parts.join(', ')
}

export default function NFS() {
  const [exports, setExports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [datasets, setDatasets] = useState([])

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPath, setEditingPath] = useState(null)
  const [form, setForm] = useState({ ...DEFAULT_FORM })
  const [modalError, setModalError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = async () => {
    try {
      const res = await api.get('/nfs')
      setExports(res.data)
    } catch {
      setError('Failed to load NFS exports')
    } finally {
      setLoading(false)
    }
  }

  const loadDatasets = async () => {
    try {
      const res = await api.get('/datasets')
      setDatasets(res.data.filter(d => d.mountpoint && d.mountpoint !== 'none' && d.mountpoint !== 'legacy'))
    } catch {
      setDatasets([])
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditingPath(null)
    setForm({ ...DEFAULT_FORM, networks: [{ address: '', prefix: '24' }], hosts: [''] })
    setModalError('')
    setSubmitting(false)
    loadDatasets()
    setModalOpen(true)
  }

  const openEdit = (exp) => {
    setEditingPath(exp.path)
    setForm(parseExportToForm(exp))
    setModalError('')
    setSubmitting(false)
    loadDatasets()
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingPath(null)
  }

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const updateNetwork = (index, field, value) => {
    setForm(prev => ({
      ...prev,
      networks: prev.networks.map((n, i) => i === index ? { ...n, [field]: value } : n),
    }))
  }

  const addNetwork = () => {
    setForm(prev => ({ ...prev, networks: [...prev.networks, { address: '', prefix: '24' }] }))
  }

  const removeNetwork = (index) => {
    setForm(prev => ({
      ...prev,
      networks: prev.networks.length > 1 ? prev.networks.filter((_, i) => i !== index) : prev.networks,
    }))
  }

  const updateHost = (index, value) => {
    setForm(prev => ({
      ...prev,
      hosts: prev.hosts.map((h, i) => i === index ? value : h),
    }))
  }

  const addHost = () => {
    setForm(prev => ({ ...prev, hosts: [...prev.hosts, ''] }))
  }

  const removeHost = (index) => {
    setForm(prev => ({
      ...prev,
      hosts: prev.hosts.length > 1 ? prev.hosts.filter((_, i) => i !== index) : prev.hosts,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setModalError('')
    setSubmitting(true)

    const clients = buildClients(form)

    try {
      if (editingPath) {
        await api.put(`/nfs/${editingPath.replace(/^\//, '')}`, { clients })
      } else {
        await api.post('/nfs', { path: form.path, clients })
      }
      closeModal()
      load()
    } catch (err) {
      setModalError(err.response?.data?.detail || (editingPath ? 'Update failed' : 'Create failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteExport = async (path) => {
    try {
      await api.delete(`/nfs/${path.replace(/^\//, '')}`)
      setConfirmDelete(null)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
      setConfirmDelete(null)
    }
  }

  const reloadExports = async () => {
    try {
      await api.post('/nfs/reload')
    } catch {
      setError('Reload failed')
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  const isFormValid = form.path.trim()
  const showAnonFields = !form.noRootSquash || form.mapAllAnon

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">NFS Exports</h2>
        <div className="flex gap-2">
          <button onClick={reloadExports} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
            Reload
          </button>
          <button onClick={openCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Add Export
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 ml-2">&times;</button>
        </div>
      )}

      {/* Exports table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Path</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Allowed Hosts</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {exports.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No NFS exports configured
                </td>
              </tr>
            )}
            {exports.map((exp, i) => (
              <tr key={i} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-gray-100">{exp.path}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {exp.clients.map((c, j) => (
                      <span key={j} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded">
                        <span className="font-medium text-gray-800 dark:text-gray-200">{c.host}</span>
                        <span className="text-gray-500 dark:text-gray-400">{summarizeOptions(c.options)}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => openEdit(exp)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">
                      Edit
                    </button>
                    <button onClick={() => setConfirmDelete(exp.path)} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete NFS export?"
          message={`This will remove the export for "${confirmDelete}" and reload NFS.`}
          confirmText="Delete Export"
          danger
          onConfirm={() => deleteExport(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Create/Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-5">
              {editingPath ? 'Edit NFS Export' : 'Add NFS Export'}
            </h3>

            <form onSubmit={handleSubmit}>
              {/* Path */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Path</label>
                {editingPath ? (
                  <div className="font-mono text-sm bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded text-gray-800 dark:text-gray-200">
                    {editingPath}
                  </div>
                ) : (
                  <>
                    {!form.customPath ? (
                      <div>
                        <select
                          value={form.path}
                          onChange={e => updateForm('path', e.target.value)}
                          className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
                        >
                          <option value="">Select a dataset...</option>
                          {datasets.map(d => (
                            <option key={d.name} value={d.mountpoint}>
                              {d.mountpoint} ({d.name}) — {d.available} free
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => updateForm('customPath', true)}
                          className="mt-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Custom path...
                        </button>
                      </div>
                    ) : (
                      <div>
                        <input
                          type="text"
                          value={form.path}
                          onChange={e => updateForm('path', e.target.value)}
                          placeholder="/path/to/export"
                          className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm font-mono"
                          required
                        />
                        {datasets.length > 0 && (
                          <button
                            type="button"
                            onClick={() => { updateForm('customPath', false); updateForm('path', '') }}
                            className="mt-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Pick from datasets...
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* General Options */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600">
                  General Options
                </h4>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.readOnly}
                      onChange={e => updateForm('readOnly', e.target.checked)}
                      className="rounded"
                    />
                    Read Only
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.sync}
                      onChange={e => updateForm('sync', e.target.checked)}
                      className="rounded"
                    />
                    Sync Writes
                    {!form.sync && <span className="text-xs text-gray-400">(async)</span>}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.noSubtreeCheck}
                      onChange={e => updateForm('noSubtreeCheck', e.target.checked)}
                      className="rounded"
                    />
                    No Subtree Check
                  </label>
                </div>
              </div>

              {/* Access */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600">
                  Access
                </h4>
                <div className="space-y-2 mb-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.noRootSquash}
                      onChange={e => updateForm('noRootSquash', e.target.checked)}
                      className="rounded"
                    />
                    No Root Squash
                    <span className="text-xs text-gray-400">Allow remote root access</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.mapAllAnon}
                      onChange={e => updateForm('mapAllAnon', e.target.checked)}
                      className="rounded"
                    />
                    Map All to Anonymous
                    <span className="text-xs text-gray-400">Squash all users</span>
                  </label>
                </div>
                {showAnonFields && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Anonymous UID</label>
                      <input
                        type="number"
                        value={form.anonUid}
                        onChange={e => updateForm('anonUid', e.target.value)}
                        placeholder="65534"
                        className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Anonymous GID</label>
                      <input
                        type="number"
                        value={form.anonGid}
                        onChange={e => updateForm('anonGid', e.target.value)}
                        placeholder="65534"
                        className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Authorization — Networks & Hosts side by side */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600">
                  Authorization
                </h4>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                  Leave empty to allow all hosts. Defining entries restricts access to listed networks and hosts only.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Networks */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Networks</label>
                      <button type="button" onClick={addNetwork} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        + Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {form.networks.map((net, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <input
                            type="text"
                            value={net.address}
                            onChange={e => updateNetwork(idx, 'address', e.target.value)}
                            placeholder="192.168.1.0"
                            className="flex-1 border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm"
                          />
                          <span className="text-gray-400 text-sm">/</span>
                          <select
                            value={net.prefix}
                            onChange={e => updateNetwork(idx, 'prefix', e.target.value)}
                            className="w-16 border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-1 py-1.5 text-sm"
                          >
                            {CIDR_PREFIXES.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                          {form.networks.length > 1 && (
                            <button type="button" onClick={() => removeNetwork(idx)} className="text-red-400 hover:text-red-600 text-sm px-1">
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Hosts */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Hosts</label>
                      <button type="button" onClick={addHost} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        + Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {form.hosts.map((host, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <input
                            type="text"
                            value={host}
                            onChange={e => updateHost(idx, e.target.value)}
                            placeholder="hostname or IP"
                            className="flex-1 border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm"
                          />
                          {form.hosts.length > 1 && (
                            <button type="button" onClick={() => removeHost(idx)} className="text-red-400 hover:text-red-600 text-sm px-1">
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Options preview */}
              <div className="mb-5 text-xs font-mono text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded">
                {buildOptionsString(form)}
              </div>

              {/* Error */}
              {modalError && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">
                  {modalError}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isFormValid || submitting}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving...' : (editingPath ? 'Update Export' : 'Add Export')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
