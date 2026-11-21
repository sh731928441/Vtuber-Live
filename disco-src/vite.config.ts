import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/disco/",
  publicDir: "public",
  build: {
    outDir: "../web/disco",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    // The app is served locally; skipping the post-bundle esbuild pass also
    // avoids a Windows temp-file lock that can fail otherwise valid builds.
    target: "esnext",
    minify: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
