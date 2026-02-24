import { useState, useEffect } from 'react'
import api from '../api'

export default function GlobalConfig() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({
    hostname: '',
    domain: '',
    additional_domains: '',
    nameserver1: '',
    nameserver2: '',
    nameserver3: '',
    ipv4_gateway: '',
    ipv6_gateway: '',
    netbios_ns: false,
    mdns: false,
    ws_discovery: false,
    http_proxy: '',
    netwait_enabled: false,
    netwait_ip_list: '',
    host_name_database: '',
  })

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/network/global-config')
        const d = res.data
        setForm({
          hostname: d.hostname || '',
          domain: d.domain || '',
          additional_domains: (d.additional_domains || []).join(', '),
          nameserver1: d.nameserver1 || '',
          nameserver2: d.nameserver2 || '',
          nameserver3: d.nameserver3 || '',
          ipv4_gateway: d.ipv4_gateway || '',
          ipv6_gateway: d.ipv6_gateway || '',
          netbios_ns: d.service_announcement?.netbios_ns || false,
          mdns: d.service_announcement?.mdns || false,
          ws_discovery: d.service_announcement?.ws_discovery || false,
          http_proxy: d.http_proxy || '',
          netwait_enabled: d.netwait_enabled || false,
          netwait_ip_list: (d.netwait_ip_list || []).join(', '),
          host_name_database: d.host_name_database || '',
        })
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load global configuration')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await api.put('/network/global-config', {
        hostname: form.hostname || null,
        domain: form.domain || null,
        additional_domains: form.additional_domains ? form.additional_domains.split(',').map(s => s.trim()).filter(Boolean) : null,
        nameserver1: form.nameserver1 || null,
        nameserver2: form.nameserver2 || null,
        nameserver3: form.nameserver3 || null,
        ipv4_gateway: form.ipv4_gateway || null,
        ipv6_gateway: form.ipv6_gateway || null,
        service_announcement: {
          netbios_ns: form.netbios_ns,
          mdns: form.mdns,
          ws_discovery: form.ws_discovery,
        },
        http_proxy: form.http_proxy,
        netwait_enabled: form.netwait_enabled,
        netwait_ip_list: form.netwait_ip_list ? form.netwait_ip_list.split(',').map(s => s.trim()).filter(Boolean) : [],
        host_name_database: form.host_name_database,
      })
      setSuccess('Global configuration saved')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save global configuration')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  const inputClass = "w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
  const labelClass = "block text-xs text-gray-500 dark:text-gray-400 mb-1"
  const sectionClass = "bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3"
  const sectionTitle = "text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 uppercase tracking-wide"

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Global Configuration</h2>

      <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 text-sm rounded">
        Changing network settings may disconnect your session.
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        {/* Hostname and Domain */}
        <div className={sectionClass}>
          <h3 className={sectionTitle}>Hostname and Domain</h3>
          <div>
            <label className={labelClass}>Hostname</label>
            <input type="text" value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value })} className={inputClass} placeholder="truenas" />
          </div>
          <div>
            <label className={labelClass}>Domain</label>
            <input type="text" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} className={inputClass} placeholder="local" />
          </div>
          <div>
            <label className={labelClass}>Additional Domains (comma-separated)</label>
            <input type="text" value={form.additional_domains} onChange={e => setForm({ ...form, additional_domains: e.target.value })} className={inputClass} placeholder="search.local, corp.example.com" />
          </div>
        </div>

        {/* DNS Servers */}
        <div className={sectionClass}>
          <h3 className={sectionTitle}>DNS Servers</h3>
          <div>
            <label className={labelClass}>Nameserver 1</label>
            <input type="text" value={form.nameserver1} onChange={e => setForm({ ...form, nameserver1: e.target.value })} className={inputClass} placeholder="8.8.8.8" />
          </div>
          <div>
            <label className={labelClass}>Nameserver 2</label>
            <input type="text" value={form.nameserver2} onChange={e => setForm({ ...form, nameserver2: e.target.value })} className={inputClass} placeholder="8.8.4.4" />
          </div>
          <div>
            <label className={labelClass}>Nameserver 3</label>
            <input type="text" value={form.nameserver3} onChange={e => setForm({ ...form, nameserver3: e.target.value })} className={inputClass} placeholder="1.1.1.1" />
          </div>
        </div>

        {/* Default Gateway */}
        <div className={sectionClass}>
          <h3 className={sectionTitle}>Default Gateway</h3>
          <div>
            <label className={labelClass}>IPv4 Gateway</label>
            <input type="text" value={form.ipv4_gateway} onChange={e => setForm({ ...form, ipv4_gateway: e.target.value })} className={inputClass} placeholder="192.168.1.1" />
          </div>
          <div>
            <label className={labelClass}>IPv6 Gateway</label>
            <input type="text" value={form.ipv6_gateway} onChange={e => setForm({ ...form, ipv6_gateway: e.target.value })} className={inputClass} placeholder="fe80::1" />
          </div>
        </div>

        {/* Service Announcement */}
        <div className={sectionClass}>
          <h3 className={sectionTitle}>Service Announcement</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.netbios_ns} onChange={e => setForm({ ...form, netbios_ns: e.target.checked })} className="rounded" />
            NetBIOS-NS
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.mdns} onChange={e => setForm({ ...form, mdns: e.target.checked })} className="rounded" />
            mDNS
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.ws_discovery} onChange={e => setForm({ ...form, ws_discovery: e.target.checked })} className="rounded" />
            WS-Discovery
          </label>
        </div>

        {/* Other Settings */}
        <div className={sectionClass}>
          <h3 className={sectionTitle}>Other Settings</h3>
          <div>
            <label className={labelClass}>HTTP Proxy</label>
            <input type="text" value={form.http_proxy} onChange={e => setForm({ ...form, http_proxy: e.target.value })} className={inputClass} placeholder="http://proxy:3128" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.netwait_enabled} onChange={e => setForm({ ...form, netwait_enabled: e.target.checked })} className="rounded" />
            Enable Network Wait
          </label>
          {form.netwait_enabled && (
            <div>
              <label className={labelClass}>Network Wait IP List (comma-separated)</label>
              <input type="text" value={form.netwait_ip_list} onChange={e => setForm({ ...form, netwait_ip_list: e.target.value })} className={inputClass} placeholder="8.8.8.8, 1.1.1.1" />
            </div>
          )}
          <div>
            <label className={labelClass}>Host Name Database</label>
            <textarea value={form.host_name_database} onChange={e => setForm({ ...form, host_name_database: e.target.value })} className={`${inputClass} h-24 resize-y`} placeholder="Additional entries for /etc/hosts" />
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
