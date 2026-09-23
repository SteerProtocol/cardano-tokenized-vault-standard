/**
 * Supplement Biome with readable vertical spacing and structural complexity limits.
 * Tests and tools follow the same limits; comments and blank lines do not consume function length.
 */

import stylistic from "@stylistic/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const declarations = ["const", "let", "var"];
const controlFlow = ["if", "for", "while", "do", "switch", "try"];

const functions = [
  "function",
  { selector: "ExportNamedDeclaration[declaration.type='FunctionDeclaration']" },
  { selector: "ExportDefaultDeclaration[declaration.type='FunctionDeclaration']" },
  {
    selector:
      ":matches(VariableDeclaration, ExportNamedDeclaration):has(VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression))",
  },
];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/build/**",
      "**/.build/**",
      "**/dist/**",
      "**/coverage/**",
      "**/artifacts/**",
      "**/evidence/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: { parser: tsParser },
    plugins: { "@stylistic": stylistic },
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: declarations },
        { blankLine: "always", prev: declarations, next: "*" },
        { blankLine: "any", prev: declarations, next: declarations },
        { blankLine: "always", prev: "*", next: controlFlow },
        { blankLine: "always", prev: controlFlow, next: "*" },
        { blankLine: "always", prev: "*", next: ["return", "throw"] },
        { blankLine: "always", prev: "*", next: functions },
        { blankLine: "always", prev: functions, next: "*" },
        { blankLine: "any", prev: "function-overload", next: "function" },
      ],
      "@stylistic/lines-between-class-members": [
        "error",
        {
          enforce: [
            { blankLine: "always", prev: "*", next: "method" },
            { blankLine: "always", prev: "method", next: "*" },
          ],
        },
      ],
    },
  },
];
