const STATUS_STYLES = {
  ONLINE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  DEGRADED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  FAULTED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  OFFLINE: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  enabled: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  disabled: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {status}
    </span>
  )
}
