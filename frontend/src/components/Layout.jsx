import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../api'
import { useTheme } from '../ThemeContext'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { label: 'Accounts', icon: '⊕', children: [
    { path: '/users', label: 'Users' },
  ]},
  { label: 'System', icon: '⊜', children: [
    { path: '/settings', label: 'Settings' },
    { path: '/enclosures', label: 'Enclosures' },
    { path: '/updates', label: 'Updates' },
    { path: '/network', label: 'Network' },
    { path: '/logs', label: 'System Logs' },
    { path: '/alerts', label: 'Email Alerts' },
  ]},
  { label: 'Tasks', icon: '⊘', children: [
    { path: '/cron-jobs', label: 'Cron Jobs' },
    { path: '/init-shutdown', label: 'Init/Shutdown Scripts' },
    { path: '/rsync-tasks', label: 'Rsync Tasks' },
    { path: '/smart-tests', label: 'S.M.A.R.T. Tests' },
    { path: '/snapshot-tasks', label: 'Periodic Snapshot Tasks' },
    { path: '/resilver', label: 'Resilver Priority' },
    { path: '/cloud-sync', label: 'Cloud Sync Tasks' },
  ]},
  { label: 'Storage', icon: '⊡', children: [
    { path: '/pools', label: 'Pools' },
    { path: '/datasets', label: 'Datasets' },
    { path: '/snapshots', label: 'Snapshots' },
    { path: '/disks', label: 'Disks' },
    { path: '/replication', label: 'Replication' },
  ]},
  { label: 'Sharing', icon: '⊞', children: [
    { path: '/shares', label: 'SMB Shares' },
    { path: '/nfs', label: 'NFS Exports' },
  ]},
  { path: '/services', label: 'Services', icon: '⊛' },
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

export default function Layout({ children, user }) {
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
      <aside className="w-56 bg-gray-900 dark:bg-gray-950 text-gray-300 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-lg font-bold text-white">Truebuntu</h1>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map(item =>
            item.children ? (
              <div key={item.label}>
                <button
                  onClick={() => toggleGroup(item.label)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-800 hover:text-white transition-colors ${
                    item.children.some(c => c.path === location.pathname) ? 'text-white' : ''
                  }`}
                >
                  <span className="flex items-center">
                    <span className="mr-3 text-base">{item.icon}</span>
                    <span className="font-medium uppercase text-xs tracking-wide">{item.label}</span>
                  </span>
                  <span className="text-xs">{expanded.has(item.label) ? '▾' : '▸'}</span>
                </button>
                {expanded.has(item.label) && (
                  <div>
                    {item.children.map(child => (
                      <Link
                        key={child.path}
                        to={child.path}
                        className={`flex items-center pl-10 pr-4 py-2 text-sm hover:bg-gray-800 hover:text-white transition-colors ${
                          location.pathname === child.path ? 'bg-gray-800 text-white border-r-2 border-blue-500' : ''
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
                className={`flex items-center px-4 py-2 text-sm hover:bg-gray-800 hover:text-white transition-colors ${
                  location.pathname === item.path ? 'bg-gray-800 text-white border-r-2 border-blue-500' : ''
                }`}
              >
                <span className="mr-3 text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          )}
        </nav>
        <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
          v0.1.0
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
    </div>
  )
}
