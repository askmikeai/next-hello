import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/admin": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      "/config": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      "/whatsapp": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
});
