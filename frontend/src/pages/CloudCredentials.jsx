import { useState, useEffect } from 'react'
import api from '../api'

const PROVIDERS = {
  b2: {
    label: 'Backblaze B2',
    fields: [
      { key: 'account', label: 'Key ID', type: 'text', required: true },
      { key: 'key', label: 'Application Key', type: 'password', required: true },
    ],
  },
  s3: {
    label: 'Amazon S3',
    fields: [
      { key: 'access_key_id', label: 'Access Key ID', type: 'text', required: true },
      { key: 'secret_access_key', label: 'Secret Access Key', type: 'password', required: true },
      { key: 'region', label: 'Region', type: 'text', placeholder: 'us-east-1' },
      { key: 'endpoint', label: 'Endpoint URL', type: 'text', placeholder: 'Leave blank for AWS' },
    ],
  },
  drive: {
    label: 'Google Drive',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
      { key: 'token', label: 'OAuth Token (JSON)', type: 'text', placeholder: 'Paste token from rclone authorize' },
    ],
    note: 'Run "rclone authorize drive" on a machine with a browser to obtain the OAuth token.',
  },
  gcs: {
    label: 'Google Cloud Storage',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
      { key: 'project_number', label: 'Project Number', type: 'text', required: true },
      { key: 'token', label: 'OAuth Token (JSON)', type: 'text', placeholder: 'Paste token from rclone authorize' },
    ],
    note: 'Run "rclone authorize gcs" on a machine with a browser to obtain the OAuth token.',
  },
  dropbox: {
    label: 'Dropbox',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
      { key: 'token', label: 'OAuth Token (JSON)', type: 'text', placeholder: 'Paste token from rclone authorize' },
    ],
    note: 'Run "rclone authorize dropbox" on a machine with a browser to obtain the OAuth token.',
  },
  onedrive: {
    label: 'Microsoft OneDrive',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
      { key: 'token', label: 'OAuth Token (JSON)', type: 'text', placeholder: 'Paste token from rclone authorize' },
      { key: 'drive_type', label: 'Drive Type', type: 'select', options: [
        { value: 'personal', label: 'Personal' },
        { value: 'business', label: 'Business' },
        { value: 'documentLibrary', label: 'SharePoint' },
      ]},
    ],
    note: 'Run "rclone authorize onedrive" on a machine with a browser to obtain the OAuth token.',
  },
  azureblob: {
    label: 'Microsoft Azure Blob',
    fields: [
      { key: 'account', label: 'Account Name', type: 'text', required: true },
      { key: 'key', label: 'Account Key', type: 'password', required: true },
    ],
  },
  mega: {
    label: 'Mega',
    fields: [
      { key: 'user', label: 'Email', type: 'text', required: true },
      { key: 'pass', label: 'Password', type: 'password', required: true },
    ],
  },
  pcloud: {
    label: 'pCloud',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
      { key: 'token', label: 'OAuth Token (JSON)', type: 'text', placeholder: 'Paste token from rclone authorize' },
    ],
    note: 'Run "rclone authorize pcloud" on a machine with a browser to obtain the OAuth token.',
  },
  webdav: {
    label: 'WebDAV',
    fields: [
      { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://example.com/dav' },
      { key: 'vendor', label: 'Vendor', type: 'select', options: [
        { value: 'other', label: 'Other' },
        { value: 'nextcloud', label: 'Nextcloud' },
        { value: 'owncloud', label: 'ownCloud' },
        { value: 'sharepoint', label: 'SharePoint Online' },
      ]},
      { key: 'user', label: 'Username', type: 'text' },
      { key: 'pass', label: 'Password', type: 'password' },
    ],
  },
  sftp: {
    label: 'SFTP',
    fields: [
      { key: 'host', label: 'Host', type: 'text', required: true },
      { key: 'port', label: 'Port', type: 'text', placeholder: '22' },
      { key: 'user', label: 'Username', type: 'text', required: true },
      { key: 'pass', label: 'Password', type: 'password' },
      { key: 'key_file', label: 'Private Key Path', type: 'text', placeholder: '/path/to/key' },
    ],
  },
  ftp: {
    label: 'FTP',
    fields: [
      { key: 'host', label: 'Host', type: 'text', required: true },
      { key: 'port', label: 'Port', type: 'text', placeholder: '21' },
      { key: 'user', label: 'Username', type: 'text' },
      { key: 'pass', label: 'Password', type: 'password' },
    ],
  },
  local: {
    label: 'Local Path',
    fields: [],
  },
}

const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100'
const labelClass = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1'

export default function CloudCredentials() {
  const [remotes, setRemotes] = useState([])
  const [selectedRemote, setSelectedRemote] = useState(null)
  const [remoteDetail, setRemoteDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [providerType, setProviderType] = useState('b2')
  const [formName, setFormName] = useState('')
  const [formConfig, setFormConfig] = useState({})
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(null)

  const load = async () => {
    try {
      const res = await api.get('/rclone/remotes')
      setRemotes(res.data)
    } catch (err) {
      setError('Failed to load cloud credentials')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const changeProvider = (type) => {
    setProviderType(type)
    setFormConfig({})
  }

  const setConfigField = (key, value) => {
    setFormConfig(prev => ({ ...prev, [key]: value }))
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
    // Filter out empty values
    const config = {}
    for (const [k, v] of Object.entries(formConfig)) {
      if (v) config[k] = v
    }
    try {
      await api.post('/rclone/remotes', { name: formName, type: providerType, config })
      setShowCreate(false)
      setFormName('')
      setProviderType('b2')
      setFormConfig({})
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteRemote = async (name) => {
    if (!confirm(`Delete credential "${name}"?`)) return
    try {
      await api.delete(`/rclone/remotes/${name}`)
      if (selectedRemote === name) { setSelectedRemote(null); setRemoteDetail(null) }
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

  const provider = PROVIDERS[providerType]

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Cloud Credentials</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          {showCreate ? 'Cancel' : 'Add Credential'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={createRemote} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className={labelClass}>Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Credential name" className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Provider</label>
              <select value={providerType} onChange={e => changeProvider(e.target.value)} className={inputClass}>
                {Object.entries(PROVIDERS).map(([type, p]) => (
                  <option key={type} value={type}>{p.label}</option>
                ))}
              </select>
            </div>
            {provider.fields.map(field => (
              <div key={field.key}>
                <label className={labelClass}>{field.label}{field.required && ' *'}</label>
                {field.type === 'select' ? (
                  <select value={formConfig[field.key] || (field.options?.[0]?.value || '')} onChange={e => setConfigField(field.key, e.target.value)} className={inputClass}>
                    {field.options.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    value={formConfig[field.key] || ''}
                    onChange={e => setConfigField(field.key, e.target.value)}
                    placeholder={field.placeholder || ''}
                    className={inputClass}
                    required={field.required}
                  />
                )}
              </div>
            ))}
          </div>
          {provider.note && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">{provider.note}</p>
          )}
          <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create Credential</button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          {remotes.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 dark:text-gray-500">No cloud credentials configured</div>
          ) : remotes.map(name => (
            <div key={name} className={`p-4 border-b dark:border-gray-700 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedRemote === name ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`} onClick={() => viewRemote(name)}>
              <span className="font-medium text-gray-900 dark:text-gray-100">{name}</span>
              <div className="flex gap-2">
                <button onClick={(e) => { e.stopPropagation(); testRemote(name) }} disabled={testing === name} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">
                  {testing === name ? 'Testing...' : 'Test'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteRemote(name) }} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs">Delete</button>
              </div>
            </div>
          ))}
        </div>

        {remoteDetail && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">{remoteDetail.name}</h3>
            <div className="space-y-2">
              {Object.entries(remoteDetail.config).map(([k, v]) => (
                <div key={k} className="flex">
                  <span className="text-sm text-gray-500 dark:text-gray-400 w-32">{k}</span>
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
