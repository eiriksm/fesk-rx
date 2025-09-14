import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: [
      'localhost',
      'linux-laptop.dolphin-pike.ts.net',
      '.ts.net',
      '.local'
    ]
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        test: path.resolve(__dirname, 'test.html')
      }
    }
  },
  resolve: {
    alias: {
      '@fesk': path.resolve(__dirname, '../src')
    }
  }
})