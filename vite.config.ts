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
      // Two pages: the cockpit (index.html) and the live depot on its own (view.html, src/viewer), which the
      // OrchestrAV and OTTO-PULSE overview tabs frame. The second shares the three/vendor chunks and loads none of
      // the cockpit.
      input: {
        main: path.resolve(__dirname, "index.html"),
        view: path.resolve(__dirname, "view.html"),
      },
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
