import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Cloudflare Pages serves this directory directly.
    outDir: 'dist',
    // A hackathon judge opens this on a phone on mobile data. Keep it small.
    target: 'es2022',
  },
})
