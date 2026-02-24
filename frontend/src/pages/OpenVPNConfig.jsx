import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

export default function OpenVPNConfig() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('client')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [installed, setInstalled] = useState(true)

  const [client, setClient] = useState({
    remote: '',
    port: 1194,
    proto: 'udp',
    dev: 'tun',
    auth: 'SHA256',
    cipher: 'AES-256-GCM',
    compress: '',
    nobind: true,
    ca: '',
    cert: '',
    key: '',
    additional_params: '',
  })

  const [server, setServer] = useState({
    server_network: '10.8.0.0 255.255.255.0',
    port: 1194,
    proto: 'udp',
    dev: 'tun',
    topology: 'subnet',
    auth: 'SHA256',
    cipher: 'AES-256-GCM',
    compress: '',
    ca: '',
    cert: '',
    key: '',
    dh: '',
    additional_params: '',
  })

  useEffect(() => {
    const load = async () => {
      try {
        const [clientRes, serverRes] = await Promise.all([
          api.get('/openvpn/client'),
          api.get('/openvpn/server'),
        ])
        setInstalled(clientRes.data.installed)
        if (clientRes.data.config) setClient(clientRes.data.config)
        if (serverRes.data.config) setServer(serverRes.data.config)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load OpenVPN configuration')
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
      if (tab === 'client') {
        await api.put('/openvpn/client', client)
      } else {
        await api.put('/openvpn/server', server)
      }
      setSuccess(`OpenVPN ${tab} configuration saved`)
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  const inputClass = "w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm dark:bg-gray-800 dark:text-gray-100"
  const labelClass = "block text-xs text-gray-500 dark:text-gray-400 mb-1"
  const sectionClass = "bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3"
  const sectionTitle = "text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 uppercase tracking-wide"
  const tabActive = "px-4 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
  const tabInactive = "px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border-b-2 border-transparent"

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/services')} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">OpenVPN Configuration</h2>
      </div>

      {!installed && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 text-sm rounded">
          OpenVPN is not installed. Install it with <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">apt install openvpn</code> to enable VPN.
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{success}</div>}

      {/* Tabs */}
      <div className="flex border-b dark:border-gray-700 mb-6">
        <button type="button" className={tab === 'client' ? tabActive : tabInactive} onClick={() => setTab('client')}>Client</button>
        <button type="button" className={tab === 'server' ? tabActive : tabInactive} onClick={() => setTab('server')}>Server</button>
      </div>

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        {tab === 'client' ? (
          <>
            <div className={sectionClass}>
              <h3 className={sectionTitle}>Connection</h3>
              <div>
                <label className={labelClass}>Remote Server</label>
                <input type="text" value={client.remote} onChange={e => setClient({ ...client, remote: e.target.value })} className={inputClass} placeholder="vpn.example.com" />
              </div>
              <div>
                <label className={labelClass}>Port</label>
                <input type="number" value={client.port} onChange={e => setClient({ ...client, port: parseInt(e.target.value) || 1194 })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Protocol</label>
                <select value={client.proto} onChange={e => setClient({ ...client, proto: e.target.value })} className={inputClass}>
                  <option value="udp">UDP</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Device</label>
                <select value={client.dev} onChange={e => setClient({ ...client, dev: e.target.value })} className={inputClass}>
                  <option value="tun">TUN</option>
                  <option value="tap">TAP</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm dark:text-gray-200">
                <input type="checkbox" checked={client.nobind} onChange={e => setClient({ ...client, nobind: e.target.checked })} className="rounded" />
                No Bind (nobind)
              </label>
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitle}>Encryption</h3>
              <div>
                <label className={labelClass}>Auth</label>
                <input type="text" value={client.auth} onChange={e => setClient({ ...client, auth: e.target.value })} className={inputClass} placeholder="SHA256" />
              </div>
              <div>
                <label className={labelClass}>Cipher</label>
                <input type="text" value={client.cipher} onChange={e => setClient({ ...client, cipher: e.target.value })} className={inputClass} placeholder="AES-256-GCM" />
              </div>
              <div>
                <label className={labelClass}>Compress</label>
                <input type="text" value={client.compress} onChange={e => setClient({ ...client, compress: e.target.value })} className={inputClass} placeholder="lzo (leave empty for none)" />
              </div>
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitle}>Certificates</h3>
              <div>
                <label className={labelClass}>CA Certificate</label>
                <textarea value={client.ca} onChange={e => setClient({ ...client, ca: e.target.value })} className={`${inputClass} h-24 resize-y font-mono text-xs`} placeholder="Paste CA certificate..." />
              </div>
              <div>
                <label className={labelClass}>Client Certificate</label>
                <textarea value={client.cert} onChange={e => setClient({ ...client, cert: e.target.value })} className={`${inputClass} h-24 resize-y font-mono text-xs`} placeholder="Paste client certificate..." />
              </div>
              <div>
                <label className={labelClass}>Client Key</label>
                <textarea value={client.key} onChange={e => setClient({ ...client, key: e.target.value })} className={`${inputClass} h-24 resize-y font-mono text-xs`} placeholder="Paste client key..." />
              </div>
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitle}>Additional Parameters</h3>
              <div>
                <label className={labelClass}>Extra config lines (one per line)</label>
                <textarea value={client.additional_params} onChange={e => setClient({ ...client, additional_params: e.target.value })} className={`${inputClass} h-20 resize-y font-mono text-xs`} placeholder="persist-key&#10;persist-tun" />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={sectionClass}>
              <h3 className={sectionTitle}>Server Settings</h3>
              <div>
                <label className={labelClass}>Server Network</label>
                <input type="text" value={server.server_network} onChange={e => setServer({ ...server, server_network: e.target.value })} className={inputClass} placeholder="10.8.0.0 255.255.255.0" />
              </div>
              <div>
                <label className={labelClass}>Port</label>
                <input type="number" value={server.port} onChange={e => setServer({ ...server, port: parseInt(e.target.value) || 1194 })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Protocol</label>
                <select value={server.proto} onChange={e => setServer({ ...server, proto: e.target.value })} className={inputClass}>
                  <option value="udp">UDP</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Device</label>
                <select value={server.dev} onChange={e => setServer({ ...server, dev: e.target.value })} className={inputClass}>
                  <option value="tun">TUN</option>
                  <option value="tap">TAP</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Topology</label>
                <select value={server.topology} onChange={e => setServer({ ...server, topology: e.target.value })} className={inputClass}>
                  <option value="subnet">Subnet</option>
                  <option value="net30">Net30</option>
                  <option value="p2p">P2P</option>
                </select>
              </div>
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitle}>Encryption</h3>
              <div>
                <label className={labelClass}>Auth</label>
                <input type="text" value={server.auth} onChange={e => setServer({ ...server, auth: e.target.value })} className={inputClass} placeholder="SHA256" />
              </div>
              <div>
                <label className={labelClass}>Cipher</label>
                <input type="text" value={server.cipher} onChange={e => setServer({ ...server, cipher: e.target.value })} className={inputClass} placeholder="AES-256-GCM" />
              </div>
              <div>
                <label className={labelClass}>Compress</label>
                <input type="text" value={server.compress} onChange={e => setServer({ ...server, compress: e.target.value })} className={inputClass} placeholder="lzo (leave empty for none)" />
              </div>
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitle}>Certificates</h3>
              <div>
                <label className={labelClass}>CA Certificate</label>
                <textarea value={server.ca} onChange={e => setServer({ ...server, ca: e.target.value })} className={`${inputClass} h-24 resize-y font-mono text-xs`} placeholder="Paste CA certificate..." />
              </div>
              <div>
                <label className={labelClass}>Server Certificate</label>
                <textarea value={server.cert} onChange={e => setServer({ ...server, cert: e.target.value })} className={`${inputClass} h-24 resize-y font-mono text-xs`} placeholder="Paste server certificate..." />
              </div>
              <div>
                <label className={labelClass}>Server Key</label>
                <textarea value={server.key} onChange={e => setServer({ ...server, key: e.target.value })} className={`${inputClass} h-24 resize-y font-mono text-xs`} placeholder="Paste server key..." />
              </div>
              <div>
                <label className={labelClass}>Diffie-Hellman Parameters</label>
                <textarea value={server.dh} onChange={e => setServer({ ...server, dh: e.target.value })} className={`${inputClass} h-24 resize-y font-mono text-xs`} placeholder="Paste DH params..." />
              </div>
            </div>

            <div className={sectionClass}>
              <h3 className={sectionTitle}>Additional Parameters</h3>
              <div>
                <label className={labelClass}>Extra config lines (one per line)</label>
                <textarea value={server.additional_params} onChange={e => setServer({ ...server, additional_params: e.target.value })} className={`${inputClass} h-20 resize-y font-mono text-xs`} placeholder="push &quot;redirect-gateway def1&quot;&#10;keepalive 10 120" />
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={saving || !installed} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : `Save ${tab === 'client' ? 'Client' : 'Server'} Config`}
          </button>
        </div>
      </form>
    </div>
  )
}
