import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/.next/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // noUncheckedIndexedAccess is on, so `!` after a bounds check is the deliberate,
      // reviewed way to narrow; banning it just pushes people to worse workarounds.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Plain Node scripts outside the TypeScript workspace (the kill-switch function).
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly", console: "readonly", fetch: "readonly", process: "readonly" },
    },
  },
);
