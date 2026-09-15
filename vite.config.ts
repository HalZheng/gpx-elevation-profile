import { defineConfig } from 'vite'

// base 使用相对路径，构建产物可直接部署到任意静态托管的任意子路径
// （GitHub Pages 项目页 / Netlify / Vercel / Cloudflare Pages 均可直接使用）
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    open: false,
  },
})
