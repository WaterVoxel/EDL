import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ApiError } from './api'

// Nothing in this app caught a rejected promise, so a failed API call vanished
// completely: the spinner cleared, no alert fired, no log line appeared, and the
// user was left looking at a UI that had simply stopped. Most call sites still
// have no .catch of their own — this is the floor under all of them, so a failure
// can never again be entirely silent.
//
// Only ApiError is surfaced. A rejection from anywhere else is a code bug rather
// than something the user can act on, and alerting on those would mean false
// alarms from React's own internals; those still reach the console exactly as
// before, since this handler deliberately does not preventDefault.
//
// Registered before the first render so it is already in place for the calls the
// app makes on mount — the media bin loads immediately, and the backend may not
// be up yet.
let lastMessage = null
window.addEventListener('unhandledrejection', e => {
  if (!(e.reason instanceof ApiError)) return
  // The mount fires several calls at once, so a backend that is down would
  // otherwise stack up one identical dialog per call. Same text twice in a row
  // is the same failure being reported twice.
  if (e.reason.message === lastMessage) return
  lastMessage = e.reason.message
  setTimeout(() => { lastMessage = null }, 3000)
  alert(e.reason.message)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
