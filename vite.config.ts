import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.PINE_API_URL ?? 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Pine compilation and execution live in `server/` (npm run server). Proxying keeps the
    // browser on one origin, so there is no CORS to configure in dev or in production.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
