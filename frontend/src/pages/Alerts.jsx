import { useState, useEffect } from 'react'
import api from '../api'

export default function Alerts() {
  const [smtp, setSmtp] = useState({
    smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '',
    smtp_from: '', smtp_recipients: '', smtp_tls: true,
  })
  const [categories, setCategories] = useState({
    cron_failures: false, rsync_failures: false,
    smart_failures: false, replication_failures: false,
  })
  const [loading, setLoading] = useState(true)
  const [smtpMsg, setSmtpMsg] = useState('')
  const [catMsg, setCatMsg] = useState('')
  const [testMsg, setTestMsg] = useState('')

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

  useEffect(() => {
    Promise.all([loadSmtp(), loadCategories()]).finally(() => setLoading(false))
  }, [])

  const saveSmtp = async (e) => {
    e.preventDefault()
    try {
      await api.put('/alerts/smtp', {
        ...smtp,
        smtp_tls: smtp.smtp_tls,
      })
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

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Email Alerts</h2>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-4">SMTP Configuration</h3>
        <form onSubmit={saveSmtp}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">SMTP Host</label>
              <input type="text" value={smtp.smtp_host} onChange={e => setSmtp({...smtp, smtp_host: e.target.value})} placeholder="smtp.example.com" className="border dark:border-gray-600 rounded px-3 py-2 text-sm w-full dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Port</label>
              <input type="number" value={smtp.smtp_port} onChange={e => setSmtp({...smtp, smtp_port: parseInt(e.target.value) || 587})} className="border dark:border-gray-600 rounded px-3 py-2 text-sm w-full dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Username</label>
              <input type="text" value={smtp.smtp_user} onChange={e => setSmtp({...smtp, smtp_user: e.target.value})} placeholder="user@example.com" className="border dark:border-gray-600 rounded px-3 py-2 text-sm w-full dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Password</label>
              <input type="password" value={smtp.smtp_password} onChange={e => setSmtp({...smtp, smtp_password: e.target.value})} className="border dark:border-gray-600 rounded px-3 py-2 text-sm w-full dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From Address</label>
              <input type="text" value={smtp.smtp_from} onChange={e => setSmtp({...smtp, smtp_from: e.target.value})} placeholder="nas@example.com" className="border dark:border-gray-600 rounded px-3 py-2 text-sm w-full dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Recipients (comma-separated)</label>
              <input type="text" value={smtp.smtp_recipients} onChange={e => setSmtp({...smtp, smtp_recipients: e.target.value})} placeholder="admin@example.com" className="border dark:border-gray-600 rounded px-3 py-2 text-sm w-full dark:bg-gray-700 dark:text-gray-100" />
            </div>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <label className="flex items-center gap-1 text-sm">
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

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-4">Alert Categories</h3>
        <div className="space-y-3 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={categories.cron_failures || false} onChange={e => setCategories({...categories, cron_failures: e.target.checked})} />
            Cron Job Failures
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={categories.rsync_failures || false} onChange={e => setCategories({...categories, rsync_failures: e.target.checked})} />
            Rsync Task Failures
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={categories.smart_failures || false} onChange={e => setCategories({...categories, smart_failures: e.target.checked})} />
            S.M.A.R.T. Test Failures
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={categories.replication_failures || false} onChange={e => setCategories({...categories, replication_failures: e.target.checked})} />
            Replication Failures
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
