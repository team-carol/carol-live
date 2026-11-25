import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` here + `npm run dev` in ../server: API calls are proxied to wrangler (port 8787)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
    },
  },
});
