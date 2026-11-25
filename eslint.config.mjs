import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import { defineConfig } from "eslint/config";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  },
  {
    ignores: ["main.js", "node_modules/**", "scripts/**", "tests/**", "esbuild.config.mjs", "vitest.config.ts", "eslint.config.mjs"],
  },
]);
