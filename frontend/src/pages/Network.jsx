import { useState, useEffect } from 'react'
import api from '../api'

const BOND_MODES = [
  { value: '802.3ad', label: '802.3ad (LACP)' },
  { value: 'balance-alb', label: 'Adaptive Load Balancing' },
  { value: 'balance-tlb', label: 'Transmit Load Balancing' },
  { value: 'active-backup', label: 'Active-Backup (Failover)' },
  { value: 'balance-rr', label: 'Round Robin' },
  { value: 'balance-xor', label: 'XOR Hash' },
]

function StateBadge({ state }) {
  const up = state === 'up'
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${up ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
      {state}
    </span>
  )
}

export default function Network() {
  const [tab, setTab] = useState('interfaces')
  const tabs = [
    { key: 'interfaces', label: 'Interfaces' },
    { key: 'bonds', label: 'Bonds' },
    { key: 'dns', label: 'DNS' },
    { key: 'routes', label: 'Routes' },
  ]

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Network</h2>
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'interfaces' && <InterfacesTab />}
      {tab === 'bonds' && <BondsTab />}
      {tab === 'dns' && <DNSTab />}
      {tab === 'routes' && <RoutesTab />}
    </div>
  )
}


function InterfacesTab() {
  const [interfaces, setInterfaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [editConfig, setEditConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [bondMembers, setBondMembers] = useState(new Set())

  useEffect(() => {
    loadInterfaces()
  }, [])

  const loadInterfaces = async () => {
    try {
      const [ifRes, bondRes] = await Promise.all([
        api.get('/network/interfaces'),
        api.get('/network/bonds'),
      ])
      setInterfaces(ifRes.data)
      const members = new Set()
      for (const bond of bondRes.data) {
        for (const m of bond.interfaces || []) members.add(m)
      }
      setBondMembers(members)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load interfaces')
    } finally {
      setLoading(false)
    }
  }

  const startEdit = async (name) => {
    if (editing === name) {
      setEditing(null)
      setEditConfig(null)
      return
    }
    try {
      const res = await api.get(`/network/interfaces/${name}/config`)
      setEditConfig({
        dhcp: res.data.dhcp ?? true,
        addresses: (res.data.addresses || []).join(', '),
        gateway: res.data.gateway || '',
        mtu: res.data.mtu || '',
        dns_servers: (res.data.dns_servers || []).join(', '),
        dns_search: (res.data.dns_search || []).join(', '),
      })
      setEditing(name)
    } catch (err) {
      setError('Failed to load interface config')
    }
  }

  const saveConfig = async () => {
    setShowConfirm(false)
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        dhcp: editConfig.dhcp,
        addresses: editConfig.dhcp ? [] : editConfig.addresses.split(',').map(s => s.trim()).filter(Boolean),
        gateway: editConfig.dhcp ? null : editConfig.gateway || null,
        mtu: editConfig.mtu ? parseInt(editConfig.mtu) : null,
        dns_servers: editConfig.dns_servers ? editConfig.dns_servers.split(',').map(s => s.trim()).filter(Boolean) : null,
        dns_search: editConfig.dns_search ? editConfig.dns_search.split(',').map(s => s.trim()).filter(Boolean) : null,
      }
      await api.put(`/network/interfaces/${editing}`, payload)
      setSuccess(`Interface ${editing} updated`)
      setEditing(null)
      setEditConfig(null)
      loadInterfaces()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update interface')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 text-sm rounded">
        Changing network settings may disconnect your session.
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">State</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">IP Address</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">MAC</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Speed</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">MTU</th>
            </tr>
          </thead>
          <tbody>
            {interfaces.map(iface => (
              <>
                <tr
                  key={iface.name}
                  onClick={() => !bondMembers.has(iface.name) && iface.type !== 'virtual' && startEdit(iface.name)}
                  className={`border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${!bondMembers.has(iface.name) && iface.type !== 'virtual' ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-4 py-2 font-medium">
                    {iface.name}
                    {bondMembers.has(iface.name) && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">bonded</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{iface.type}</td>
                  <td className="px-4 py-2"><StateBadge state={iface.state} /></td>
                  <td className="px-4 py-2 font-mono text-xs">{iface.addresses.join(', ') || '-'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{iface.mac || '-'}</td>
                  <td className="px-4 py-2">{iface.speed || '-'}</td>
                  <td className="px-4 py-2">{iface.mtu || '-'}</td>
                </tr>
                {editing === iface.name && editConfig && (
                  <tr key={`${iface.name}-edit`} className="border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="max-w-xl space-y-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editConfig.dhcp}
                            onChange={e => setEditConfig({ ...editConfig, dhcp: e.target.checked })}
                            className="rounded"
                          />
                          DHCP
                        </label>
                        {!editConfig.dhcp && (
                          <>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">IP Addresses (CIDR, comma-separated)</label>
                              <input
                                type="text"
                                value={editConfig.addresses}
                                onChange={e => setEditConfig({ ...editConfig, addresses: e.target.value })}
                                placeholder="192.168.1.100/24"
                                className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Gateway</label>
                              <input
                                type="text"
                                value={editConfig.gateway}
                                onChange={e => setEditConfig({ ...editConfig, gateway: e.target.value })}
                                placeholder="192.168.1.1"
                                className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
                              />
                            </div>
                          </>
                        )}
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">MTU</label>
                          <input
                            type="number"
                            value={editConfig.mtu}
                            onChange={e => setEditConfig({ ...editConfig, mtu: e.target.value })}
                            placeholder="1500"
                            className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">DNS Servers (comma-separated)</label>
                          <input
                            type="text"
                            value={editConfig.dns_servers}
                            onChange={e => setEditConfig({ ...editConfig, dns_servers: e.target.value })}
                            placeholder="8.8.8.8, 8.8.4.4"
                            className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">DNS Search Domains (comma-separated)</label>
                          <input
                            type="text"
                            value={editConfig.dns_search}
                            onChange={e => setEditConfig({ ...editConfig, dns_search: e.target.value })}
                            placeholder="example.com"
                            className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => setShowConfirm(true)}
                            disabled={saving}
                            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditing(null); setEditConfig(null) }}
                            className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                          >
                            Cancel
                          </button>
                        </div>
                        {showConfirm && (
                          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
                            <p className="text-sm text-yellow-800 dark:text-yellow-400 mb-2">
                              Applying network changes may disconnect your current session. Continue?
                            </p>
                            <div className="flex gap-2">
                              <button onClick={saveConfig} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                                Confirm
                              </button>
                              <button onClick={() => setShowConfirm(false)} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {interfaces.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No interfaces found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function BondsTab() {
  const [bonds, setBonds] = useState([])
  const [interfaces, setInterfaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingBond, setEditingBond] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [form, setForm] = useState(emptyBondForm())

  function emptyBondForm() {
    return {
      name: '',
      interfaces: [],
      mode: '802.3ad',
      dhcp: true,
      addresses: '',
      gateway: '',
      mtu: '',
      dns_servers: '',
      lacp_rate: 'fast',
      mii_monitor_interval: 100,
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [bondRes, ifRes] = await Promise.all([
        api.get('/network/bonds'),
        api.get('/network/interfaces'),
      ])
      setBonds(bondRes.data)
      setInterfaces(ifRes.data.filter(i => i.type === 'physical'))
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load bonds')
    } finally {
      setLoading(false)
    }
  }

  const bondMemberSet = new Set()
  for (const b of bonds) {
    for (const m of b.interfaces || []) bondMemberSet.add(m)
  }

  const availableInterfaces = (currentBondMembers) => {
    const currentSet = new Set(currentBondMembers || [])
    return interfaces.filter(i => !bondMemberSet.has(i.name) || currentSet.has(i.name))
  }

  const toggleInterface = (name) => {
    setForm(f => ({
      ...f,
      interfaces: f.interfaces.includes(name)
        ? f.interfaces.filter(n => n !== name)
        : [...f.interfaces, name],
    }))
  }

  const createBond = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        name: form.name,
        interfaces: form.interfaces,
        mode: form.mode,
        dhcp: form.dhcp,
        addresses: form.dhcp ? null : form.addresses.split(',').map(s => s.trim()).filter(Boolean),
        gateway: form.dhcp ? null : form.gateway || null,
        mtu: form.mtu ? parseInt(form.mtu) : null,
        dns_servers: form.dns_servers ? form.dns_servers.split(',').map(s => s.trim()).filter(Boolean) : null,
        lacp_rate: form.mode === '802.3ad' ? form.lacp_rate : null,
        mii_monitor_interval: form.mii_monitor_interval ? parseInt(form.mii_monitor_interval) : 100,
      }
      await api.post('/network/bonds', payload)
      setSuccess(`Bond ${form.name} created`)
      setShowCreate(false)
      setForm(emptyBondForm())
      loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create bond')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (bond) => {
    if (editingBond === bond.name) {
      setEditingBond(null)
      return
    }
    setForm({
      name: bond.name,
      interfaces: bond.interfaces || [],
      mode: bond.mode || '802.3ad',
      dhcp: bond.dhcp ?? true,
      addresses: (bond.addresses || []).join(', '),
      gateway: bond.gateway || '',
      mtu: bond.mtu || '',
      dns_servers: (bond.dns_servers || []).join(', '),
      lacp_rate: bond.lacp_rate || 'fast',
      mii_monitor_interval: bond.mii_monitor_interval ?? 100,
    })
    setEditingBond(bond.name)
    setShowCreate(false)
  }

  const updateBond = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        interfaces: form.interfaces,
        mode: form.mode,
        dhcp: form.dhcp,
        addresses: form.dhcp ? null : form.addresses.split(',').map(s => s.trim()).filter(Boolean),
        gateway: form.dhcp ? null : form.gateway || null,
        mtu: form.mtu ? parseInt(form.mtu) : null,
        dns_servers: form.dns_servers ? form.dns_servers.split(',').map(s => s.trim()).filter(Boolean) : null,
        lacp_rate: form.mode === '802.3ad' ? form.lacp_rate : null,
        mii_monitor_interval: form.mii_monitor_interval ? parseInt(form.mii_monitor_interval) : 100,
      }
      await api.put(`/network/bonds/${editingBond}`, payload)
      setSuccess(`Bond ${editingBond} updated`)
      setEditingBond(null)
      setForm(emptyBondForm())
      loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update bond')
    } finally {
      setSaving(false)
    }
  }

  const deleteBond = async (name) => {
    setDeleteConfirm(null)
    setError('')
    setSuccess('')
    try {
      await api.delete(`/network/bonds/${name}`)
      setSuccess(`Bond ${name} deleted`)
      loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete bond')
    }
  }

  const renderBondForm = (isCreate) => {
    const currentMembers = isCreate ? [] : (bonds.find(b => b.name === editingBond)?.interfaces || [])
    const avail = availableInterfaces(currentMembers)
    return (
      <div className="p-4 bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 rounded-lg space-y-3 mb-4">
        {isCreate && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Bond Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="bond0"
              className="w-full max-w-xs px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Mode</label>
          <select
            value={form.mode}
            onChange={e => setForm({ ...form, mode: e.target.value })}
            className="w-full max-w-xs px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
          >
            {BOND_MODES.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Member Interfaces</label>
          {avail.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No available physical interfaces</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {avail.map(iface => (
                <label key={iface.name} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.interfaces.includes(iface.name)}
                    onChange={() => toggleInterface(iface.name)}
                    className="rounded"
                  />
                  {iface.name}
                </label>
              ))}
            </div>
          )}
        </div>
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
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">IP Addresses (CIDR, comma-separated)</label>
              <input
                type="text"
                value={form.addresses}
                onChange={e => setForm({ ...form, addresses: e.target.value })}
                placeholder="192.168.1.100/24"
                className="w-full max-w-md px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Gateway</label>
              <input
                type="text"
                value={form.gateway}
                onChange={e => setForm({ ...form, gateway: e.target.value })}
                placeholder="192.168.1.1"
                className="w-full max-w-xs px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">MTU</label>
          <input
            type="number"
            value={form.mtu}
            onChange={e => setForm({ ...form, mtu: e.target.value })}
            placeholder="1500"
            className="w-full max-w-xs px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">DNS Servers (comma-separated)</label>
          <input
            type="text"
            value={form.dns_servers}
            onChange={e => setForm({ ...form, dns_servers: e.target.value })}
            placeholder="8.8.8.8, 8.8.4.4"
            className="w-full max-w-md px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        {form.mode === '802.3ad' && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">LACP Rate</label>
            <select
              value={form.lacp_rate}
              onChange={e => setForm({ ...form, lacp_rate: e.target.value })}
              className="w-full max-w-xs px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="fast">Fast</option>
              <option value="slow">Slow</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">MII Monitor Interval (ms)</label>
          <input
            type="number"
            value={form.mii_monitor_interval}
            onChange={e => setForm({ ...form, mii_monitor_interval: e.target.value })}
            placeholder="100"
            className="w-full max-w-xs px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={isCreate ? createBond : updateBond}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : isCreate ? 'Create Bond' : 'Update Bond'}
          </button>
          <button
            onClick={() => { isCreate ? setShowCreate(false) : setEditingBond(null); setForm(emptyBondForm()) }}
            className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      <div className="mb-4">
        <button
          onClick={() => { setShowCreate(!showCreate); setEditingBond(null); setForm(emptyBondForm()) }}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Create Bond
        </button>
      </div>

      {showCreate && renderBondForm(true)}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Bond Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Mode</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Members</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">IP Address</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">State</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bonds.map(bond => (
              <>
                <tr key={bond.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-2 font-medium">{bond.name}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{bond.mode}</td>
                  <td className="px-4 py-2 font-mono text-xs">{(bond.interfaces || []).join(', ')}</td>
                  <td className="px-4 py-2 font-mono text-xs">{(bond.addresses || []).join(', ') || (bond.dhcp ? 'DHCP' : '-')}</td>
                  <td className="px-4 py-2"><StateBadge state={bond.state} /></td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(bond)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(bond.name)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {editingBond === bond.name && (
                  <tr key={`${bond.name}-edit`} className="border-t dark:border-gray-700">
                    <td colSpan={6} className="px-4 py-4">
                      {renderBondForm(false)}
                    </td>
                  </tr>
                )}
              </>
            ))}
            {bonds.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No bonds configured</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-sm">
            <p className="text-sm text-gray-700 dark:text-gray-200 mb-4">
              Delete bond <strong>{deleteConfirm}</strong>? This will apply network changes immediately.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => deleteBond(deleteConfirm)} className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">
                Delete
              </button>
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function DNSTab() {
  const [dns, setDns] = useState({ servers: [], search: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/network/dns')
        setDns(res.data)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load DNS info')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase">DNS Servers</h3>
          </div>
          <div className="p-4">
            {dns.servers.length > 0 ? (
              <ul className="space-y-1">
                {dns.servers.map((s, i) => (
                  <li key={i} className="font-mono text-sm">{s}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">No DNS servers found</p>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase">Search Domains</h3>
          </div>
          <div className="p-4">
            {dns.search.length > 0 ? (
              <ul className="space-y-1">
                {dns.search.map((d, i) => (
                  <li key={i} className="font-mono text-sm">{d}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">No search domains found</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


function RoutesTab() {
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/network/routes')
        setRoutes(res.data)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load routes')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Destination</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Gateway</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Interface</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Metric</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => (
              <tr key={i} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-2 font-mono text-xs">{r.destination || '-'}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.gateway || '-'}</td>
                <td className="px-4 py-2">{r.interface || '-'}</td>
                <td className="px-4 py-2">{r.metric || '-'}</td>
              </tr>
            ))}
            {routes.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No routes found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
