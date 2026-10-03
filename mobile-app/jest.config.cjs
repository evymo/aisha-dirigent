/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js)'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
  },
  // `@aisha/extranet-sdk-*` jsou ESM-only a schválně bez buildu (buildless SDK),
  // takže je jest MUSÍ transformovat — jinak spadne na `import` uvnitř balíku
  // hláškou „unexpected token", která na balík vůbec neukazuje.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native|@react-native|@react-native-community|expo|expo-.*|@expo|expo-router|@react-navigation|react-navigation|@sentry|react-native-svg|@aisha/extranet-sdk-.*)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/', '/.expo/'],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,tsx}',
  ],
};
