import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "out/**", "node_modules/**", "coverage/**", "next-env.d.ts", "video/node_modules/**", "video/out/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly", fetch: "readonly", Buffer: "readonly", AbortSignal: "readonly", setTimeout: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off",
    },
  },
);
