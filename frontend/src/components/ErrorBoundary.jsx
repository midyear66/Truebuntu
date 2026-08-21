import { Component } from 'react'

/**
 * Catches render-time exceptions so one bad component shows a recoverable
 * message instead of blanking the whole app. React has no hook equivalent —
 * error boundaries must be class components.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-full max-w-lg">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
            This page stopped responding
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
            Something in the interface hit an error. Your NAS itself is unaffected —
            pools, shares, and scheduled tasks keep running. Reloading usually clears it.
          </p>

          <div className="flex gap-2 mb-6">
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-medium"
            >
              Reload
            </button>
            <button
              onClick={() => { window.location.href = '/dashboard' }}
              className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
            >
              Back to dashboard
            </button>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              Error details
            </summary>
            <pre className="mt-2 p-3 bg-gray-50 dark:bg-gray-900 rounded overflow-x-auto text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
