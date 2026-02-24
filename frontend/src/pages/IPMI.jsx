import { useState, useEffect } from 'react'
import api from '../api'

export default function IPMI() {
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [identifying, setIdentifying] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({
    dhcp: true,
    ipv4_address: '',
    ipv4_netmask: '',
    ipv4_gateway: '',
    vlan_id: '',
    password: '',
  })

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/network/ipmi')
        if (!res.data.available) {
          setAvailable(false)
        } else {
          setAvailable(true)
          setForm({
            dhcp: res.data.dhcp ?? true,
            ipv4_address: res.data.ipv4_address || '',
            ipv4_netmask: res.data.ipv4_netmask || '',
            ipv4_gateway: res.data.ipv4_gateway || '',
            vlan_id: res.data.vlan_id != null ? String(res.data.vlan_id) : '',
            password: '',
          })
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load IPMI configuration')
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
      await api.put('/network/ipmi', {
        dhcp: form.dhcp,
        ipv4_address: form.dhcp ? null : form.ipv4_address || null,
        ipv4_netmask: form.dhcp ? null : form.ipv4_netmask || null,
        ipv4_gateway: form.dhcp ? null : form.ipv4_gateway || null,
        vlan_id: form.vlan_id ? parseInt(form.vlan_id) : null,
        password: form.password || null,
      })
      setSuccess('IPMI configuration saved')
      setForm(f => ({ ...f, password: '' }))
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save IPMI configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleIdentify = async () => {
    setIdentifying(true)
    setError('')
    setSuccess('')
    try {
      await api.post('/network/ipmi/identify')
      setSuccess('Identify light activated for 15 seconds')
      setTimeout(() => setSuccess(''), 5000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to activate identify light')
    } finally {
      setIdentifying(false)
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  if (!available) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">IPMI</h2>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-gray-500 dark:text-gray-400">IPMI not available on this system.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
            No IPMI hardware was detected, or ipmitool is not installed.
          </p>
        </div>
      </div>
    )
  }

  const inputClass = "w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
  const labelClass = "block text-xs text-gray-500 dark:text-gray-400 mb-1"

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">IPMI</h2>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <form onSubmit={handleSave} className="max-w-xl space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.dhcp}
              onChange={e => setForm({ ...form, dhcp: e.target.checked })}
              className="rounded"
            />
            DHCP
          </label>

          {!form.dhcp && (
            <>
              <div>
                <label className={labelClass}>IPv4 Address</label>
                <input type="text" value={form.ipv4_address} onChange={e => setForm({ ...form, ipv4_address: e.target.value })} className={inputClass} placeholder="192.168.1.50" />
              </div>
              <div>
                <label className={labelClass}>IPv4 Netmask</label>
                <input type="text" value={form.ipv4_netmask} onChange={e => setForm({ ...form, ipv4_netmask: e.target.value })} className={inputClass} placeholder="255.255.255.0" />
              </div>
              <div>
                <label className={labelClass}>IPv4 Default Gateway</label>
                <input type="text" value={form.ipv4_gateway} onChange={e => setForm({ ...form, ipv4_gateway: e.target.value })} className={inputClass} placeholder="192.168.1.1" />
              </div>
            </>
          )}

          <div>
            <label className={labelClass}>VLAN ID</label>
            <input type="number" value={form.vlan_id} onChange={e => setForm({ ...form, vlan_id: e.target.value })} className={inputClass} placeholder="Optional" />
          </div>

          <div>
            <label className={labelClass}>Password</label>
            <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className={inputClass} placeholder="Leave blank to keep current" />
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={handleIdentify} disabled={identifying} className="px-4 py-2 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50">
            {identifying ? 'Flashing...' : 'Identify Light'}
          </button>
        </div>
      </form>
    </div>
  )
}
