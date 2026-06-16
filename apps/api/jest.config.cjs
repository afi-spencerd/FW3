/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testRegex: "\\.spec\\.ts$",
  moduleNameMapper: {
    // Resolve the workspace package from TS source — it ships as ESM, which
    // Jest's CommonJS loader can't require. ts-jest transpiles the source.
    "^@fw3/shared-types$": "<rootDir>/../../packages/shared-types/src/index.ts",
    // shared-types source uses explicit .js specifiers (ESM); strip them so they
    // resolve to the .ts source under ts-jest.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    // Jest-only tsconfig enables isolatedModules (transpile-only), keeping the
    // Nest build's tsconfig untouched.
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.spec.json" }],
  },
};
