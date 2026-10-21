import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In Docker the API is reached as http://api:8000; on the host it is localhost:8000.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
