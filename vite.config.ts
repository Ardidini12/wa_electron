import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-react',
    chunkSizeWarningLimit: 1000, // Increase chunk size limit for Electron app (1MB)
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['chart.js', 'react-chartjs-2'],
          datepicker: ['react-datepicker']
        }
      }
    }
  },
  server: {
    port: 5123,
    strictPort: true
  }
})
