import { useState, useEffect } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'

const DEFAULT_FORM = {
  name: '',
  path: '',
  customPath: false,
  comment: '',
  readOnly: false,
  browseable: true,
  guestOk: false,
  validUsers: '',
  writeList: '',
  hostsAllow: [''],
  hostsDeny: [''],
  createMask: '0664',
  directoryMask: '0775',
  auxParams: '',
}

// Keys we handle explicitly — everything else goes to auxParams
const KNOWN_KEYS = new Set([
  'name', 'path', 'comment', 'read only', 'browseable', 'guest ok',
  'valid users', 'write list', 'create mask', 'directory mask',
  'hosts allow', 'hosts deny',
])

function parseShareToForm(share) {
  const form = {
    name: share.name || '',
    path: share.path || '',
    customPath: true,
    comment: share.comment || '',
    readOnly: share['read only'] === 'yes',
    browseable: share.browseable !== 'no',
    guestOk: share['guest ok'] === 'yes',
    validUsers: share['valid users'] || '',
    writeList: share['write list'] || '',
    hostsAllow: [],
    hostsDeny: [],
    createMask: share['create mask'] || '0664',
    directoryMask: share['directory mask'] || '0775',
    auxParams: '',
  }

  const hostsAllow = share['hosts allow'] || ''
  form.hostsAllow = hostsAllow ? hostsAllow.split(/\s+/).filter(Boolean) : []
  if (form.hostsAllow.length === 0) form.hostsAllow = ['']

  const hostsDeny = share['hosts deny'] || ''
  form.hostsDeny = hostsDeny ? hostsDeny.split(/\s+/).filter(Boolean) : []
  if (form.hostsDeny.length === 0) form.hostsDeny = ['']

  // Collect unknown keys into auxParams
  const auxLines = []
  for (const [key, value] of Object.entries(share)) {
    if (!KNOWN_KEYS.has(key)) {
      auxLines.push(`${key} = ${value}`)
    }
  }
  form.auxParams = auxLines.join('\n')

  return form
}

function buildPayload(form, isEdit) {
  const extra = {}

  const hostsAllow = form.hostsAllow.map(h => h.trim()).filter(Boolean).join(' ')
  if (hostsAllow) extra['hosts allow'] = hostsAllow

  const hostsDeny = form.hostsDeny.map(h => h.trim()).filter(Boolean).join(' ')
  if (hostsDeny) extra['hosts deny'] = hostsDeny

  // Parse auxiliary parameters
  for (const line of form.auxParams.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (key && !KNOWN_KEYS.has(key)) {
        extra[key] = value
      }
    }
  }

  const payload = {
    path: form.path,
    comment: form.comment,
    browseable: form.browseable ? 'yes' : 'no',
    read_only: form.readOnly ? 'yes' : 'no',
    guest_ok: form.guestOk ? 'yes' : 'no',
    valid_users: form.validUsers,
    write_list: form.writeList,
    create_mask: form.createMask,
    directory_mask: form.directoryMask,
    extra,
  }

  if (!isEdit) {
    payload.name = form.name
  }

  return payload
}

export default function Shares() {
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [datasets, setDatasets] = useState([])

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingName, setEditingName] = useState(null)
  const [form, setForm] = useState({ ...DEFAULT_FORM })
  const [modalError, setModalError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = async () => {
    try {
      const res = await api.get('/shares')
      setShares(res.data)
    } catch {
      setError('Failed to load shares')
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
    setEditingName(null)
    setForm({ ...DEFAULT_FORM, hostsAllow: [''], hostsDeny: [''] })
    setModalError('')
    setSubmitting(false)
    loadDatasets()
    setModalOpen(true)
  }

  const openEdit = (share) => {
    setEditingName(share.name)
    setForm(parseShareToForm(share))
    setModalError('')
    setSubmitting(false)
    loadDatasets()
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingName(null)
  }

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Multi-row helpers for hostsAllow / hostsDeny
  const updateListEntry = (field, index, value) => {
    setForm(prev => ({
      ...prev,
      [field]: prev[field].map((v, i) => i === index ? value : v),
    }))
  }

  const addListEntry = (field) => {
    setForm(prev => ({ ...prev, [field]: [...prev[field], ''] }))
  }

  const removeListEntry = (field, index) => {
    setForm(prev => ({
      ...prev,
      [field]: prev[field].length > 1 ? prev[field].filter((_, i) => i !== index) : prev[field],
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setModalError('')
    setSubmitting(true)

    const payload = buildPayload(form, !!editingName)

    try {
      if (editingName) {
        await api.put(`/shares/${editingName}`, payload)
      } else {
        await api.post('/shares', payload)
      }
      closeModal()
      load()
    } catch (err) {
      setModalError(err.response?.data?.detail || (editingName ? 'Update failed' : 'Create failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteShare = async (name) => {
    try {
      await api.delete(`/shares/${name}`)
      setConfirmDelete(null)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
      setConfirmDelete(null)
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  const isFormValid = form.path.trim() && (editingName || form.name.trim())

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">SMB Shares</h2>
        <button onClick={openCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Create Share
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 ml-2">&times;</button>
        </div>
      )}

      {/* Shares table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Path</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Description</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Access</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shares.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No SMB shares configured
                </td>
              </tr>
            )}
            {shares.map(s => (
              <tr key={s.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{s.path}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.comment || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s['read only'] === 'yes' ? (
                      <span className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 px-2 py-0.5 rounded">RO</span>
                    ) : (
                      <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded">RW</span>
                    )}
                    {s['guest ok'] === 'yes' && (
                      <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded">Guest</span>
                    )}
                    {s.browseable !== 'no' && (
                      <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded">Browsable</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => openEdit(s)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">
                      Edit
                    </button>
                    <button onClick={() => setConfirmDelete(s.name)} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs">
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
          title="Delete SMB share?"
          message={`This will permanently remove the share "${confirmDelete}".`}
          confirmText="Delete Share"
          danger
          onConfirm={() => deleteShare(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Create/Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-5">
              {editingName ? 'Edit SMB Share' : 'Create SMB Share'}
            </h3>

            <form onSubmit={handleSubmit}>
              {/* Section 1: Basic */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600">
                  Basic
                </h4>

                {/* Path */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Path</label>
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
                        placeholder="/mnt/pool/share"
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
                </div>

                {/* Name */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Name</label>
                  {editingName ? (
                    <div className="font-mono text-sm bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded text-gray-800 dark:text-gray-200">
                      {editingName}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => updateForm('name', e.target.value)}
                      placeholder="share_name"
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
                      required
                    />
                  )}
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Description</label>
                  <input
                    type="text"
                    value={form.comment}
                    onChange={e => updateForm('comment', e.target.value)}
                    placeholder="Optional description"
                    className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Section 2: Access */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600">
                  Access
                </h4>

                <div className="space-y-2 mb-4">
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
                      checked={form.browseable}
                      onChange={e => updateForm('browseable', e.target.checked)}
                      className="rounded"
                    />
                    Browsable
                    <span className="text-xs text-gray-400">Visible in network browse lists</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.guestOk}
                      onChange={e => updateForm('guestOk', e.target.checked)}
                      className="rounded"
                    />
                    Guest Access
                    <span className="text-xs text-gray-400">Allow unauthenticated access</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Valid Users</label>
                    <input
                      type="text"
                      value={form.validUsers}
                      onChange={e => updateForm('validUsers', e.target.value)}
                      placeholder="user1, @group1"
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-1.5 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-0.5">Comma-separated users/groups</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Write List</label>
                    <input
                      type="text"
                      value={form.writeList}
                      onChange={e => updateForm('writeList', e.target.value)}
                      placeholder="user1, @group1"
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-1.5 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-0.5">Users with write access (even if RO)</p>
                  </div>
                </div>

                {/* Hosts Allow / Deny */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Hosts Allow */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Hosts Allow</label>
                      <button type="button" onClick={() => addListEntry('hostsAllow')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        + Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {form.hostsAllow.map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <input
                            type="text"
                            value={entry}
                            onChange={e => updateListEntry('hostsAllow', idx, e.target.value)}
                            placeholder="192.168.1.0/24 or hostname"
                            className="flex-1 border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm"
                          />
                          {form.hostsAllow.length > 1 && (
                            <button type="button" onClick={() => removeListEntry('hostsAllow', idx)} className="text-red-400 hover:text-red-600 text-sm px-1">
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Hosts Deny */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Hosts Deny</label>
                      <button type="button" onClick={() => addListEntry('hostsDeny')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        + Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {form.hostsDeny.map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <input
                            type="text"
                            value={entry}
                            onChange={e => updateListEntry('hostsDeny', idx, e.target.value)}
                            placeholder="192.168.2.0/24 or hostname"
                            className="flex-1 border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm"
                          />
                          {form.hostsDeny.length > 1 && (
                            <button type="button" onClick={() => removeListEntry('hostsDeny', idx)} className="text-red-400 hover:text-red-600 text-sm px-1">
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Permissions */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600">
                  Permissions
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Create Mask</label>
                    <input
                      type="text"
                      value={form.createMask}
                      onChange={e => updateForm('createMask', e.target.value)}
                      placeholder="0664"
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Directory Mask</label>
                    <input
                      type="text"
                      value={form.directoryMask}
                      onChange={e => updateForm('directoryMask', e.target.value)}
                      placeholder="0775"
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Auxiliary Parameters */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600">
                  Auxiliary Parameters
                </h4>
                <textarea
                  value={form.auxParams}
                  onChange={e => updateForm('auxParams', e.target.value)}
                  placeholder={"vfs objects = fruit streams_xattr\nfruit:metadata = stream"}
                  rows={3}
                  className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">Additional smb.conf parameters, one per line (key = value)</p>
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
                  {submitting ? 'Saving...' : (editingName ? 'Update Share' : 'Create Share')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
