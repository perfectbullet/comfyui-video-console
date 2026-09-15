import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // ★ base 必须是相对路径 './'，不能保持默认的 '/'
  //   同一份产物要在两个地址下都能跑：
  //     - http://192.168.8.231:8600/                 （docker vue-web，根路径）
  //     - https://ailabs.zenking.cc/archiver/         （线上 nginx，子路径）
  //   base:'/' 会把资源引用写成 /assets/index-xxx.js（绝对路径）。
  //   放在 /archiver/ 子路径下时，浏览器会去请求域名根的 /assets/...，
  //   那里是另一个站点（禅境AI）的 SPA 兜底，返回 text/html，
  //   于是报：Expected a JavaScript-or-Wasm module script but the server
  //   responded with a MIME type of "text/html"。
  //   确需锁定子路径时，用 VITE_BASE_PATH=/archiver/ 覆盖即可。
  base: process.env.VITE_BASE_PATH || './',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 8600
  },
  build: {
    outDir: 'dist'
  }
})
