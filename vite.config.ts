import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: {
    __PARENT_ASSET_ROOT__: JSON.stringify(path.resolve(__dirname, ".."))
  },
  plugins: [react()],
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")]
    },
    host: "0.0.0.0",
    port: 5173
  }
});
