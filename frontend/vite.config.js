import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 loopback explicitly. Vite's default host is the string
    // "localhost", which Node resolves to IPv6 ::1 on this machine -- the
    // dev server then answers http://localhost:5173/ but NOT
    // http://127.0.0.1:5173/ (connection refused). Pinning 127.0.0.1 serves
    // both spellings and stays loopback-only (no LAN exposure, unlike
    // host: true).
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5001',
      '/input': 'http://127.0.0.1:5001',
      '/output': 'http://127.0.0.1:5001',
      '/preview': 'http://127.0.0.1:5001',
    },
  },
})
