import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `pnpm dev:phone` serves over HTTPS on your local network so a phone can use Web MIDI
// (browsers only expose MIDI on secure pages). The backend stays private behind the proxy.
export default defineConfig(({ mode }) => {
  const phone = mode === 'phone'
  return {
    plugins: [react(), ...(phone ? [basicSsl()] : [])],
    server: {
      host: phone ? '0.0.0.0' : 'localhost',
      port: 5173,
      proxy: {
        '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
  }
})
