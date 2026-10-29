/// <reference types="vitest/config" />
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { FsSessions, fsApiPlugin } from './scripts/fsApi.ts'
import { launcherPlugin } from './scripts/launcher.ts'
import { maskApiPlugin } from './scripts/maskApi.ts'
import { fileShareStore, lanSharePlugin, ShareState } from './scripts/lanShare.ts'

// 열린 게임 세션은 폴더 API와 휴대폰 보기가 함께 쓴다.
const sessions = new FsSessions()
const share = new ShareState({ sessions, store: fileShareStore() })

// https://vite.dev/config/
export default defineConfig({
  // 휴대폰 보기를 위해 모든 네트워크에서 듣는다. 이 PC가 아닌 요청은 lanSharePlugin이 맨 앞에서 막는다.
  server: { host: true },
  // npm start(빌드 + preview)도 개발 서버와 같은 주소(5173)로 연다 — 브라우저 저장값·휴대폰 주소가 그대로 이어진다.
  preview: { host: true, port: 5173 },
  plugins: [lanSharePlugin(share), react(), tailwindcss(), launcherPlugin(), fsApiPlugin({ sessions, remote: share }), maskApiPlugin({ sessions, remote: share })],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
