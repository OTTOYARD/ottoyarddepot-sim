import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    // 8080 stays the default; PORT lets a second dev server (a parallel review
    // session, a preview harness) run without colliding with the first.
    port: Number(process.env.PORT) || 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand'],
        },
      },
    },
  },
}));
