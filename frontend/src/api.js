import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Paths where a 401 is a normal answer rather than a session that went away:
// the startup probe, and the login / 2FA exchanges themselves. Firing the
// session-expired event for these would bounce the user off the login form they
// are currently trying to use.
const AUTH_PROBE_PATHS = [
  '/auth/me',
  '/auth/setup-required',
  '/auth/login',
  '/auth/setup',
  '/auth/2fa/verify',
]

export const SESSION_EXPIRED_EVENT = 'truebuntu:session-expired'

// A 401 anywhere else means the session was revoked (logout elsewhere, password
// change) or simply expired. Without this every page just rendered its own
// error string and the user was left staring at a dead dashboard.
api.interceptors.response.use(
  response => response,
  error => {
    const status = error.response?.status
    const url = error.config?.url || ''
    if (status === 401 && !AUTH_PROBE_PATHS.some(path => url.startsWith(path))) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    }
    return Promise.reject(error)
  },
)

export default api
