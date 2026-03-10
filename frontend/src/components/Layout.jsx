import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../api'
import { useTheme } from '../ThemeContext'
import ConfirmDialog from './ConfirmDialog'
import logo from '../assets/logo.svg'
import logoDark from '../assets/logo-dark.svg'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: '\u{1F4CA}' },
  { label: 'Accounts', icon: '\u{1F465}', admin: true, children: [
    { path: '/app-users', label: 'App users' },
    { path: '/smb-users', label: 'SMB users' },
    { path: '/system-users', label: 'System users & groups' },
    { path: '/cloud-credentials', label: 'Cloud credentials' },
  ]},
  { label: 'System', icon: '\u{2699}\uFE0F', admin: true, children: [
    { path: '/settings', label: 'Settings' },
    { path: '/enclosures', label: 'Enclosures' },
    { path: '/updates', label: 'Updates' },
    { path: '/logs', label: 'System logs' },
    { path: '/alerts', label: 'Alerts' },
  ]},
  { path: '/jobs', label: 'Jobs', icon: '\u{23F3}' },
  { label: 'Network', icon: '\u{1F310}', admin: true, children: [
    { path: '/network', label: 'Network summary' },
    { path: '/network/global', label: 'Global configuration' },
    { path: '/network/interfaces', label: 'Interfaces' },
    { path: '/network/static-routes', label: 'Static routes' },
    { path: '/network/ipmi', label: 'IPMI' },
  ]},
  { label: 'Tasks', icon: '\u{1F552}', admin: true, children: [
    { path: '/cron-jobs', label: 'Cron jobs' },
    { path: '/init-shutdown', label: 'Init/shutdown scripts' },
    { path: '/rsync-tasks', label: 'Rsync tasks' },
    { path: '/smart-tests', label: 'S.M.A.R.T. tests' },
    { path: '/snapshot-tasks', label: 'Periodic snapshot tasks' },
    { path: '/resilver', label: 'Resilver priority' },
    { path: '/cloud-sync', label: 'Cloud sync tasks' },
  ]},
  { label: 'Storage', icon: '\u{1F4BE}', children: [
    { path: '/pools', label: 'Pools' },
    { path: '/datasets', label: 'Datasets' },
    { path: '/snapshots', label: 'Snapshots' },
    { path: '/disks', label: 'Disks' },
    { path: '/replication', label: 'Replication' },
  ]},
  { label: 'Sharing', icon: '\u{1F4C1}', children: [
    { path: '/shares', label: 'SMB shares' },
    { path: '/nfs', label: 'NFS exports' },
  ]},
  { path: '/services', label: 'Services', icon: '\u{1F527}' },
  { path: '/shell', label: 'Shell', icon: '\u{1F4DF}', admin: true },
]

function findGroupForPath(pathname) {
  for (const item of NAV_ITEMS) {
    if (item.children) {
      for (const child of item.children) {
        if (child.path === pathname) return item.label
      }
    }
  }
  return null
}

export default function Layout({ children, user, isAdmin }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [pollInterval, setPollInterval] = useState(() =>
    parseInt(localStorage.getItem('poll-interval')) || 5
  )
  const [showPollMenu, setShowPollMenu] = useState(false)

  const pollOptions = [
    { label: '2s', value: 2 },
    { label: '5s', value: 5 },
    { label: '10s', value: 10 },
    { label: '30s', value: 30 },
    { label: '60s', value: 60 },
    { label: 'Off', value: 0 },
  ]

  const changePoll = (seconds) => {
    setPollInterval(seconds)
    localStorage.setItem('poll-interval', String(seconds))
    window.dispatchEvent(new Event('poll-interval-changed'))
    setShowPollMenu(false)
  }
  const [showPowerMenu, setShowPowerMenu] = useState(false)
  const [powerConfirm, setPowerConfirm] = useState(null)
  const [powerMsg, setPowerMsg] = useState('')

  const handlePower = async (action) => {
    setPowerConfirm(null)
    setShowPowerMenu(false)
    try {
      await api.post(`/system/${action}`)
      setPowerMsg(action === 'reboot' ? 'Reboot initiated...' : 'Shutdown initiated...')
    } catch (err) {
      setPowerMsg(err.response?.data?.detail || `Failed to ${action}`)
    }
  }

  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')
    if (pwForm.new_password !== pwForm.confirm) {
      setPwError('New passwords do not match')
      return
    }
    try {
      await api.post('/auth/change-password', {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      })
      setPwSuccess('Password changed successfully')
      setPwForm({ current_password: '', new_password: '', confirm: '' })
      setTimeout(() => setShowPwModal(false), 1500)
    } catch (err) {
      setPwError(err.response?.data?.detail || 'Failed to change password')
    }
  }

  const [expanded, setExpanded] = useState(() => {
    const group = findGroupForPath(location.pathname)
    return group ? new Set([group]) : new Set()
  })

  useEffect(() => {
    const group = findGroupForPath(location.pathname)
    if (group) {
      setExpanded(new Set([group]))
    }
  }, [location.pathname])

  const toggleGroup = (label) => {
    setExpanded(prev => prev.has(label) ? new Set() : new Set([label]))
  }

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch (e) {}
    window.location.href = '/'
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <aside className="w-56 bg-gray-200 dark:bg-gray-950 text-gray-600 dark:text-gray-300 flex flex-col border-r border-gray-300 dark:border-gray-800">
        <div className="px-4 py-5 border-b border-gray-300 dark:border-gray-700">
          <img src={logo} alt="Truebuntu" className="h-14 dark:hidden" />
          <img src={logoDark} alt="Truebuntu" className="h-14 hidden dark:block" />
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.filter(item => !item.admin || isAdmin).map(item =>
            item.children ? (
              <div key={item.label}>
                <button
                  onClick={() => toggleGroup(item.label)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-300 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white transition-colors ${
                    item.children.some(c => c.path === location.pathname) ? 'text-gray-900 dark:text-white' : ''
                  }`}
                >
                  <span className="flex items-center">
                    <span className="mr-3 text-base">{item.icon}</span>
                    <span className="font-medium text-xs tracking-wide">{item.label}</span>
                  </span>
                  <span className="text-xs">{expanded.has(item.label) ? '▾' : '▸'}</span>
                </button>
                {expanded.has(item.label) && (
                  <div>
                    {item.children.map(child => (
                      <Link
                        key={child.path}
                        to={child.path}
                        className={`flex items-center pl-10 pr-4 py-2 text-sm hover:bg-gray-300 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white transition-colors ${
                          location.pathname === child.path ? 'bg-gray-300 text-gray-900 border-r-2 border-blue-500 dark:bg-gray-800 dark:text-white' : ''
                        }`}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-4 py-2 text-sm hover:bg-gray-300 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white transition-colors ${
                  location.pathname === item.path ? 'bg-gray-300 text-gray-900 border-r-2 border-blue-500 dark:bg-gray-800 dark:text-white' : ''
                }`}
              >
                <span className="mr-3 text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          )}
        </nav>
        <div className="p-4 border-t border-gray-300 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-between">
          <span>v0.1.0</span>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <div className="relative">
                <button
                  onClick={() => setShowPowerMenu(!showPowerMenu)}
                  title="Power"
                  className="hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                    <line x1="12" y1="2" x2="12" y2="12" />
                  </svg>
                </button>
                {showPowerMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowPowerMenu(false)} />
                    <div className="absolute bottom-6 right-0 w-36 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-1 z-50">
                      <button
                        onClick={() => { setShowPowerMenu(false); setPowerConfirm('reboot') }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                      >
                        Reboot
                      </button>
                      <button
                        onClick={() => { setShowPowerMenu(false); setPowerConfirm('shutdown') }}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-600"
                      >
                        Shut Down
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <a href="https://github.com/midyear66/Truebuntu" target="_blank" rel="noopener noreferrer" title="GitHub" className="hover:text-gray-600 dark:hover:text-gray-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            </a>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-300" id="header-info"></div>
          <div className="flex items-center gap-4">
            <button
              onClick={toggle}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '\u2600' : '\u263E'}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowPollMenu(!showPollMenu)}
                className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                title="Polling interval"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{pollInterval > 0 ? `${pollInterval}s` : 'Off'}</span>
                <span className="text-xs">{showPollMenu ? '\u25B4' : '\u25BE'}</span>
              </button>
              {showPollMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowPollMenu(false)} />
                  <div className="absolute right-0 mt-2 w-32 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-1 z-50">
                    {pollOptions.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => changePoll(opt.value)}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${
                          pollInterval === opt.value
                            ? 'text-blue-600 dark:text-blue-400 font-medium'
                            : 'text-gray-700 dark:text-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white"
              >
                {user}
                <span className="text-xs">{showUserMenu ? '\u25B4' : '\u25BE'}</span>
              </button>
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-1 z-50">
                    <button
                      onClick={() => { setShowUserMenu(false); setPwError(''); setPwSuccess(''); setPwForm({ current_password: '', new_password: '', confirm: '' }); setShowPwModal(true) }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      Change Password
                    </button>
                    <button
                      onClick={() => { setShowUserMenu(false); handleLogout() }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>

      {showPwModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={handleChangePassword} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Change Password</h3>
            {pwError && <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{pwError}</div>}
            {pwSuccess && <div className="mb-3 p-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{pwSuccess}</div>}
            <div className="space-y-3 mb-4">
              <input type="password" value={pwForm.current_password} onChange={e => setPwForm({...pwForm, current_password: e.target.value})} placeholder="Current password" className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" required />
              <input type="password" value={pwForm.new_password} onChange={e => setPwForm({...pwForm, new_password: e.target.value})} placeholder="New password (min 8 chars)" className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" required minLength={8} />
              <input type="password" value={pwForm.confirm} onChange={e => setPwForm({...pwForm, confirm: e.target.value})} placeholder="Confirm new password" className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" required minLength={8} />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowPwModal(false)} className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Change</button>
            </div>
          </form>
        </div>
      )}

      {powerConfirm && (
        <ConfirmDialog
          title={powerConfirm === 'reboot' ? 'Reboot System' : 'Shut Down System'}
          message={powerConfirm === 'reboot'
            ? 'Are you sure you want to reboot? All active connections and services will be interrupted.'
            : 'Are you sure you want to shut down? The system will power off and must be physically turned back on.'}
          confirmText={powerConfirm === 'reboot' ? 'Reboot' : 'Shut Down'}
          danger={true}
          onConfirm={() => handlePower(powerConfirm)}
          onCancel={() => setPowerConfirm(null)}
        />
      )}

      {powerMsg && (
        <div className="fixed bottom-4 right-4 bg-amber-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm z-50">
          {powerMsg}
        </div>
      )}
    </div>
  )
}
