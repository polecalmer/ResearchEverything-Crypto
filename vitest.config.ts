import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "server/**/*.{test,spec}.ts",
      "client/src/**/*.{test,spec}.ts",
      "client/src/**/*.{test,spec}.tsx",
      "shared/**/*.{test,spec}.ts",
    ],
    exclude: ["node_modules", "dist"],
    coverage: {
      reporter: ["text", "html"],
      include: [
        "server/**/*.ts",
        "client/src/**/*.{ts,tsx}",
        "shared/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "node_modules/**",
        "dist/**",
      ],
    },
  },
});
