import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    port: 5173,
    // Tauri expects a fixed port; fail if it's not available
    strictPort: true,
    // Use the value from the Tauri CLI or fallback to localhost
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5183,
        }
      : undefined,
    watch: {
/// Watch the Rust source files so Vite can reload when they change.
      /// Tauri handles its own rebuild; Vite should not re-trigger on Rust changes.
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Produce sourcemaps only in debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
