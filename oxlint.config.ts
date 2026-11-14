import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "node", "react"],
  categories: {
    correctness: "error",
    suspicious: "error",
  },
  ignorePatterns: [
    "**/dist/**",
    "**/out/**",
    "**/release/**",
    ".claude/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
  overrides: [
    {
      // The YAML boundary: the one module that inspects the runtime type of
      // parsed user input. `typeof` is allowed there only inside type
      // predicates. Not enabled globally, where a predicate would just launder
      // a branch on a declared union that the rule exists to catch.
      files: ["packages/core/src/lib/config-yaml.ts"],
      rules: {
        "anti-slop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
      },
    },
  ],
});
