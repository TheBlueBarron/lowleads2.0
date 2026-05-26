/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  moduleNameMapper: {
    '^@lowleads/shared-types$': '<rootDir>/../../../packages/shared-types/src/index.ts',
    '^@lowleads/db$': '<rootDir>/../../../packages/db/src/client.ts',
    // TypeScript ESM-style relative imports keep .js extension at source; strip
    // it so ts-jest resolves the .ts file.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.test.ts',
    '!**/*.integration.test.ts',
    '!__tests__/**',
    '!index.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
    },
    './services/auth/auth.service.ts': {
      lines: 100,
    },
    './lib/crypto.ts': {
      lines: 100,
    },
  },
  testTimeout: 30_000,
};
