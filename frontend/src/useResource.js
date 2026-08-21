import { useState, useEffect, useCallback, useRef } from 'react'
import api from './api'

/**
 * Load a GET endpoint into component state.
 *
 * Replaces the fetch/loading/error triad that every page was hand-rolling —
 * ~40 separate `[loading, setLoading]` pairs and close to 200 `setError` call
 * sites, each with its own idea of what an error looks like.
 *
 * Returns `setData` as well, because pages routinely edit the loaded resource
 * locally before saving it, and `setError` so a page can report its own
 * mutation failures through the same channel as load failures.
 *
 * A 401 is deliberately not handled here: the axios interceptor in api.js turns
 * it into a session-expired event that drops the whole app to the login form.
 *
 * @param {string|null} path      API path, relative to /api. Null skips loading.
 * @param {object}      options
 * @param {*}           options.initial   Value for `data` before the first load.
 * @param {boolean}     options.enabled   Set false to defer loading.
 * @param {string}      options.errorMessage  Overrides the server's detail text.
 */
export default function useResource(path, options = {}) {
  const { initial = null, enabled = true, errorMessage } = options

  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const mounted = useRef(true)

  const reload = useCallback(async () => {
    if (!path) return undefined
    setLoading(true)
    try {
      const res = await api.get(path)
      if (mounted.current) {
        setData(res.data)
        setError('')
      }
      return res.data
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage || err.response?.data?.detail || 'Failed to load')
      }
      return undefined
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [path, errorMessage])

  useEffect(() => {
    mounted.current = true
    if (enabled) reload()
    // Guards against setting state on an unmounted component — easy to hit here,
    // because every page is now lazily loaded and can unmount mid-request.
    return () => { mounted.current = false }
  }, [reload, enabled])

  return { data, setData, loading, error, setError, reload }
}
