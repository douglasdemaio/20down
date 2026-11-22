import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const nestedMocker = (suffix: string) =>
  fileURLToPath(new URL(`./node_modules/vitest/node_modules/@vitest/mocker/dist/${suffix}`, import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { GEO_BLOCKLIST: "IR" } },
    }),
  ],
  resolve: {
    alias: [
      { find: "@vitest/mocker/redirect", replacement: nestedMocker("redirect.js") },
      { find: "@vitest/mocker", replacement: nestedMocker("index.js") },
    ],
  },
  test: {
    include: ["test/**/*.spec.ts"],
  },
});
