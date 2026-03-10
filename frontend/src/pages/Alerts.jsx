import { useState, useEffect } from 'react'
import api from '../api'

const SERVICE_TYPES = {
  slack: {
    label: 'Slack',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://hooks.slack.com/services/...' },
    ],
  },
  pagerduty: {
    label: 'PagerDuty',
    fields: [
      { key: 'integration_key', label: 'Integration Key', type: 'password', required: true },
    ],
  },
  pushover: {
    label: 'Pushover',
    fields: [
      { key: 'user_key', label: 'User Key', type: 'password', required: true },
      { key: 'api_token', label: 'API Token', type: 'password', required: true },
    ],
  },
  webhook: {
    label: 'Webhook',
    fields: [
      { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://example.com/webhook' },
    ],
  },
}

const inputClass = 'border dark:border-gray-600 rounded px-3 py-2 text-sm w-full dark:bg-gray-700 dark:text-gray-100'

export default function Alerts() {
  const [smtp, setSmtp] = useState({
    smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '',
    smtp_from: '', smtp_recipients: '', smtp_tls: true,
  })
  const [categories, setCategories] = useState({
    cron_failures: false, rsync_failures: false,
    smart_failures: false, replication_failures: false,
    scrub_failures: false, pool_degraded: false, pool_capacity: false,
  })
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [smtpMsg, setSmtpMsg] = useState('')
  const [catMsg, setCatMsg] = useState('')
  const [testMsg, setTestMsg] = useState('')
  const [svcMsg, setSvcMsg] = useState('')
  const [showAddService, setShowAddService] = useState(false)
  const [svcForm, setSvcForm] = useState({ name: '', type: 'slack', config: {}, enabled: true })
  const [testingSvc, setTestingSvc] = useState(null)

  const loadSmtp = async () => {
    try {
      const res = await api.get('/alerts/smtp')
      setSmtp(prev => ({
        ...prev,
        smtp_host: res.data.smtp_host || '',
        smtp_port: parseInt(res.data.smtp_port) || 587,
        smtp_user: res.data.smtp_user || '',
        smtp_password: res.data.smtp_password || '',
        smtp_from: res.data.smtp_from || '',
        smtp_recipients: res.data.smtp_recipients || '',
        smtp_tls: res.data.smtp_tls !== '0',
      }))
    } catch (err) {
      console.error('Failed to load SMTP config:', err)
    }
  }

  const loadCategories = async () => {
    try {
      const res = await api.get('/alerts/settings')
      setCategories(res.data)
    } catch (err) {
      console.error('Failed to load alert settings:', err)
    }
  }

  const loadServices = async () => {
    try {
      const res = await api.get('/alerts/services')
      setServices(res.data)
    } catch (err) {
      console.error('Failed to load alert services:', err)
    }
  }

  useEffect(() => {
    Promise.all([loadSmtp(), loadCategories(), loadServices()]).finally(() => setLoading(false))
  }, [])

  const saveSmtp = async (e) => {
    e.preventDefault()
    try {
      await api.put('/alerts/smtp', { ...smtp, smtp_tls: smtp.smtp_tls })
      setSmtpMsg('SMTP config saved')
      setTimeout(() => setSmtpMsg(''), 3000)
    } catch (err) {
      setSmtpMsg(err.response?.data?.detail || 'Save failed')
    }
  }

  const sendTest = async () => {
    setTestMsg('Sending...')
    try {
      await api.post('/alerts/test')
      setTestMsg('Test email sent!')
      setTimeout(() => setTestMsg(''), 3000)
    } catch (err) {
      setTestMsg(err.response?.data?.detail || 'Send failed')
    }
  }

  const saveCategories = async () => {
    try {
      await api.put('/alerts/settings', categories)
      setCatMsg('Alert settings saved')
      setTimeout(() => setCatMsg(''), 3000)
    } catch (err) {
      setCatMsg(err.response?.data?.detail || 'Save failed')
    }
  }

  const changeSvcType = (type) => {
    setSvcForm(prev => ({ ...prev, type, config: {} }))
  }

  const createService = async (e) => {
    e.preventDefault()
    try {
      await api.post('/alerts/services', svcForm)
      setShowAddService(false)
      setSvcForm({ name: '', type: 'slack', config: {}, enabled: true })
      loadServices()
      setSvcMsg('Alert service created')
      setTimeout(() => setSvcMsg(''), 3000)
    } catch (err) {
      setSvcMsg(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteService = async (id) => {
    if (!confirm('Delete this alert service?')) return
    try {
      await api.delete(`/alerts/services/${id}`)
      loadServices()
    } catch (err) {
      setSvcMsg(err.response?.data?.detail || 'Delete failed')
    }
  }

  const toggleService = async (svc) => {
    try {
      await api.put(`/alerts/services/${svc.id}`, { enabled: !svc.enabled })
      loadServices()
    } catch (err) {
      setSvcMsg(err.response?.data?.detail || 'Update failed')
    }
  }

  const testService = async (id) => {
    setTestingSvc(id)
    try {
      const res = await api.post(`/alerts/services/${id}/test`)
      alert(res.data.message || 'Test sent!')
    } catch (err) {
      alert(err.response?.data?.detail || 'Test failed')
    } finally {
      setTestingSvc(null)
    }
  }

  const svcTypeInfo = SERVICE_TYPES[svcForm.type]

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Alerts</h2>

      {/* SMTP Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-4">Email (SMTP)</h3>
        <form onSubmit={saveSmtp}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">SMTP Host</label>
              <input type="text" value={smtp.smtp_host} onChange={e => setSmtp({...smtp, smtp_host: e.target.value})} placeholder="smtp.example.com" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Port</label>
              <input type="number" value={smtp.smtp_port} onChange={e => setSmtp({...smtp, smtp_port: parseInt(e.target.value) || 587})} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Username</label>
              <input type="text" value={smtp.smtp_user} onChange={e => setSmtp({...smtp, smtp_user: e.target.value})} placeholder="user@example.com" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Password</label>
              <input type="password" value={smtp.smtp_password} onChange={e => setSmtp({...smtp, smtp_password: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From Address</label>
              <input type="text" value={smtp.smtp_from} onChange={e => setSmtp({...smtp, smtp_from: e.target.value})} placeholder="nas@example.com" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Recipients (comma-separated)</label>
              <input type="text" value={smtp.smtp_recipients} onChange={e => setSmtp({...smtp, smtp_recipients: e.target.value})} placeholder="admin@example.com" className={inputClass} />
            </div>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <label className="flex items-center gap-1 text-sm dark:text-gray-300">
              <input type="checkbox" checked={smtp.smtp_tls} onChange={e => setSmtp({...smtp, smtp_tls: e.target.checked})} />
              Use STARTTLS
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Save</button>
            <button type="button" onClick={sendTest} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Send Test Email</button>
            {smtpMsg && <span className="text-sm text-green-600">{smtpMsg}</span>}
            {testMsg && <span className="text-sm text-blue-600">{testMsg}</span>}
          </div>
        </form>
      </div>

      {/* Alert Services */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Alert Services</h3>
          <button onClick={() => setShowAddService(!showAddService)} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
            {showAddService ? 'Cancel' : 'Add Service'}
          </button>
        </div>

        {svcMsg && <div className="mb-3 text-sm text-green-600 dark:text-green-400">{svcMsg}</div>}

        {showAddService && (
          <form onSubmit={createService} className="border dark:border-gray-700 rounded p-4 mb-4 bg-gray-50 dark:bg-gray-750">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</label>
                <input type="text" value={svcForm.name} onChange={e => setSvcForm({...svcForm, name: e.target.value})} placeholder="Service name" className={inputClass} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Type</label>
                <select value={svcForm.type} onChange={e => changeSvcType(e.target.value)} className={inputClass}>
                  {Object.entries(SERVICE_TYPES).map(([type, info]) => (
                    <option key={type} value={type}>{info.label}</option>
                  ))}
                </select>
              </div>
              {svcTypeInfo.fields.map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{field.label}{field.required && ' *'}</label>
                  <input
                    type={field.type}
                    value={svcForm.config[field.key] || ''}
                    onChange={e => setSvcForm({...svcForm, config: {...svcForm.config, [field.key]: e.target.value}})}
                    placeholder={field.placeholder || ''}
                    className={inputClass}
                    required={field.required}
                  />
                </div>
              ))}
            </div>
            <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
          </form>
        )}

        {services.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No alert services configured. Alerts will only be sent via email.</p>
        ) : (
          <div className="space-y-2">
            {services.map(svc => (
              <div key={svc.id} className="flex items-center justify-between p-3 border dark:border-gray-700 rounded">
                <div className="flex items-center gap-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${svc.enabled ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{svc.name}</span>
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{SERVICE_TYPES[svc.type]?.label || svc.type}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => testService(svc.id)} disabled={testingSvc === svc.id} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs">
                    {testingSvc === svc.id ? 'Testing...' : 'Test'}
                  </button>
                  <button onClick={() => toggleService(svc)} className="text-xs text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                    {svc.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => deleteService(svc.id)} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alert Categories */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-4">Alert Categories</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Enable categories to receive alerts via email and all configured services above.</p>
        <div className="space-y-3 mb-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mt-1">Tasks</p>
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input type="checkbox" checked={categories.cron_failures || false} onChange={e => setCategories({...categories, cron_failures: e.target.checked})} />
            Cron Job Failures
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input type="checkbox" checked={categories.rsync_failures || false} onChange={e => setCategories({...categories, rsync_failures: e.target.checked})} />
            Rsync Task Failures
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input type="checkbox" checked={categories.smart_failures || false} onChange={e => setCategories({...categories, smart_failures: e.target.checked})} />
            S.M.A.R.T. Test Failures
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input type="checkbox" checked={categories.replication_failures || false} onChange={e => setCategories({...categories, replication_failures: e.target.checked})} />
            Replication Failures
          </label>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mt-3">ZFS / Storage</p>
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input type="checkbox" checked={categories.scrub_failures || false} onChange={e => setCategories({...categories, scrub_failures: e.target.checked})} />
            Scrub Failures
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input type="checkbox" checked={categories.pool_degraded || false} onChange={e => setCategories({...categories, pool_degraded: e.target.checked})} />
            Pool Degraded / Faulted
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input type="checkbox" checked={categories.pool_capacity || false} onChange={e => setCategories({...categories, pool_capacity: e.target.checked})} />
            Pool Capacity Warning (80%+)
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={saveCategories} className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Save</button>
          {catMsg && <span className="text-sm text-green-600">{catMsg}</span>}
        </div>
      </div>
    </div>
  )
}
