import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.freshdesk\.com.*$/, '')
    .replace(/\/$/, '')
}

function freshdeskConfigPlugin(domain: string): Plugin {
  return {
    name: 'freshdesk-config',
    configureServer(server) {
      server.middlewares.use('/api/config', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ domain }))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const domain = normalizeDomain(env.FRESHDESK_DOMAIN ?? '')
  const apiKey = env.FRESHDESK_API_KEY ?? ''
  const freshdeskHost = domain ? `${domain}.freshdesk.com` : 'example.freshdesk.com'

  return {
    plugins: [react(), freshdeskConfigPlugin(domain)],
    server: {
      proxy: {
        '/api/v2': {
          target: `https://${freshdeskHost}`,
          changeOrigin: true,
          secure: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) {
                const auth = Buffer.from(`${apiKey}:X`).toString('base64')
                proxyReq.setHeader('Authorization', `Basic ${auth}`)
              }
            })
          },
        },
      },
    },
  }
})
