import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the React app runs on :5173 and forwards every /api
// request to the Express server on :5000, so the browser never needs CORS
// and the API key never leaves the server.
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:5000';
const proxy = { '/api': { target: apiTarget, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { chunkSizeWarningLimit: 6000 }, // the Monaco editor is large by design
});
