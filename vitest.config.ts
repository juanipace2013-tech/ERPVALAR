import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Ningún test habla con servicios reales (Colppy, ARCA, ML, Microsoft, DB)
    setupFiles: ['tests/setup/sin-servicios-reales.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
