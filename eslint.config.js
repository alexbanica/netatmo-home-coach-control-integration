export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    ignores: ["node_modules/**", "coverage/**"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-constant-condition": "error",
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "object-shorthand": ["error", "always"],
      "prefer-const": "error"
    }
  }
];
