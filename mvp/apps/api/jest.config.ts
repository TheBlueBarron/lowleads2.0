import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  moduleNameMapper: {
    '^@lowleads/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@lowleads/db$': '<rootDir>/../../packages/db/src/client.ts',
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
  coverageThresholds: {
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

export default config;
