import { copyFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const distDir = fileURLToPath(new URL("./dist", import.meta.url));

/**
 * GitHub Pages serves `404.html` for unknown paths. Shipping a copy of the
 * built SPA shell there makes deep links like `/20down/table/T-123` load the
 * client, which then reads the table id from the URL.
 */
function githubPagesFallback(): Plugin {
  return {
    name: "github-pages-fallback",
    apply: "build",
    closeBundle: async () => {
      await copyFile(`${distDir}/index.html`, `${distDir}/404.html`);
    },
  };
}

// GitHub Pages serves this project from https://<user>.github.io/20down/.
export default defineConfig({
  base: "/20down/",
  plugins: [react(), githubPagesFallback()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    global: "globalThis",
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
