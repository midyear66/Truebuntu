import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import StatusBadge from '../components/StatusBadge'

const CONFIG_ROUTES = {
  ddclient: '/services/ddns',
  vsftpd: '/services/ftp',
  'nut-monitor': '/services/ups',
  openvpn: '/services/openvpn',
  snmpd: '/services/snmp',
}

const INSTALL_COMMANDS = {
  ddclient: 'apt install ddclient',
  vsftpd: 'apt install vsftpd',
  'nut-monitor': 'apt install nut-client',
  openvpn: 'apt install openvpn',
  snmpd: 'apt install snmpd',
  chrony: 'apt install chrony',
  smartmontools: 'apt install smartmontools',
  'zabbix-agent2': 'apt install zabbix-agent2',
  smbd: 'apt install samba',
  nmbd: 'apt install samba',
  'nfs-kernel-server': 'apt install nfs-kernel-server',
  ssh: 'apt install openssh-server',
  'zfs-zed': 'apt install zfsutils-linux',
  docker: 'apt install docker.io',
}

export default function Services() {
  const navigate = useNavigate()
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(null)
  const [error, setError] = useState('')
  const [installHint, setInstallHint] = useState(null)

  const load = async () => {
    try {
      const res = await api.get('/services')
      setServices(res.data)
    } catch (err) {
      setError('Failed to load services')
    } finally {
      setLoading(false)
    }
  }

  const performAction = async (name, action) => {
    setActing(`${name}-${action}`)
    try {
      await api.post(`/services/${name}/${action}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || `${action} failed`)
    } finally {
      setActing(null)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Services</h2>
        <button onClick={load} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
          Refresh
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Service</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Active</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Enabled</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map(svc => (
              <tr key={svc.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{svc.name}</td>
                <td className="px-4 py-3"><StatusBadge status={svc.active} /></td>
                <td className="px-4 py-3"><StatusBadge status={svc.enabled} /></td>
                <td className="px-4 py-3 text-right space-x-1">
                  {CONFIG_ROUTES[svc.name] && (
                    <button onClick={() => navigate(CONFIG_ROUTES[svc.name])} className="px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-400 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/40">
                      Configure
                    </button>
                  )}
                  {svc.active === 'inactive' && svc.enabled === 'not-found' ? (
                    <button onClick={() => setInstallHint(svc.name)} className="px-2 py-1 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400 rounded hover:bg-orange-200 dark:hover:bg-orange-900/40">
                      Install
                    </button>
                  ) : (
                    <>
                      {svc.active === 'active' ? (
                        <>
                          <button onClick={() => performAction(svc.name, 'restart')} disabled={!!acting} className="px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/40 disabled:opacity-50">
                            Restart
                          </button>
                          <button onClick={() => performAction(svc.name, 'stop')} disabled={!!acting} className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/40 disabled:opacity-50">
                            Stop
                          </button>
                        </>
                      ) : (
                        <button onClick={() => performAction(svc.name, 'start')} disabled={!!acting} className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/40 disabled:opacity-50">
                          Start
                        </button>
                      )}
                      {svc.enabled === 'enabled' ? (
                        <button onClick={() => performAction(svc.name, 'disable')} disabled={!!acting} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                          Disable
                        </button>
                      ) : (
                        <button onClick={() => performAction(svc.name, 'enable')} disabled={!!acting} className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded hover:bg-blue-200 disabled:opacity-50">
                          Enable
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Install hint popup */}
      {installHint && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setInstallHint(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">Install {installHint}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This service is not installed. Run the following command on the host to install it:
            </p>
            <code className="block bg-gray-100 dark:bg-gray-900 text-sm px-4 py-3 rounded font-mono text-gray-800 dark:text-gray-200 select-all">
              {INSTALL_COMMANDS[installHint] || `apt install ${installHint}`}
            </code>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setInstallHint(null)} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
