/// <reference types="vitest/config" />
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fsApiPlugin } from './scripts/fsApi.ts'
import { launcherPlugin } from './scripts/launcher.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), launcherPlugin(), fsApiPlugin()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
