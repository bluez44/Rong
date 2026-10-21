const path = require('node:path');

// Một bản React duy nhất: app (qua apps/mobile/node_modules) và test-renderer (qua node_modules gốc)
// có thể trỏ tới hai bản cài khác nhau dù cùng phiên bản, làm hook báo "useState of null".
const reactDir = path.dirname(require.resolve('react/package.json'));

/** Jest cho app mobile: preset của Expo lo biên dịch và mock module native. */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    // Đặt trước alias '@/': '@/global.css' phải thành stub, không phải file CSS thật.
    '\\.css$': '<rootDir>/jest/css-stub.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^react$': reactDir,
    '^react/(.*)$': `${reactDir}/$1`,
  },
  setupFiles: ['<rootDir>/jest/setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
