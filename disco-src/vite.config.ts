import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/disco/",
  publicDir: "public",
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787', // 后端服务地址
        changeOrigin: true,              // 推荐开启，修改请求头中的 Origin
        // rewrite 是可选的，取决于你的后端接口路径是否包含 /api
      }
    }
  },
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
