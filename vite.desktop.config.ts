import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function stripFileCrossorigin(): Plugin {
  return {
    name: "strip-file-crossorigin",
    apply: "build",
    closeBundle() {
      const htmlPath = resolve(__dirname, "desktop/dist/index.html");
      const html = readFileSync(htmlPath, "utf8").replace(/ crossorigin/g, "");
      writeFileSync(htmlPath, html);
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "desktop"),
  base: "./",
  plugins: [react(), tailwindcss(), stripFileCrossorigin()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: resolve(__dirname, "desktop/dist"),
    emptyOutDir: true,
  },
});