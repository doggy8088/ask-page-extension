module.exports = {
  env: {
    browser: true,
    es2021: true,
    webextensions: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script'
  },
  globals: {
    // Chrome Extension APIs
    chrome: 'readonly',

    // 外部函式庫
    marked: 'readonly',
    DOMPurify: 'readonly'
  },
  rules: {
    // 程式碼風格
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'indent': ['error', 4],
    'comma-dangle': ['error', 'never'],

    // 最佳實踐
    'no-unused-vars': 'warn',
    'no-console': 'off', // 擴充功能開發時需要 console
    'eqeqeq': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',

    // 變數宣告
    'no-undef': 'error',
    'no-global-assign': 'error',

    // 空白和格式
    'no-trailing-spaces': 'error',
    'no-multiple-empty-lines': ['error', { max: 2 }],
    'eol-last': 'error',

    // 函式
    'func-call-spacing': 'error',
    'no-extra-parens': ['error', 'functions'],

    // 物件和陣列
    'object-curly-spacing': ['error', 'always'],
    'array-bracket-spacing': ['error', 'never'],

    // 條件和迴圈
    'brace-style': ['error', '1tbs', { allowSingleLine: true }],
    'curly': ['error', 'all'],

    // 錯誤處理
    'no-unreachable': 'error'
  },
  overrides: [
    {
      // 針對 background.js 的特殊規則
      files: ['background.js'],
      env: {
        serviceworker: true
      }
    },
    {
      // 針對 content.js 的特殊規則
      files: ['content.js'],
      env: {
        browser: true
      }
    },
    {
      // 針對 popup.js 的特殊規則
      files: ['popup.js'],
      env: {
        browser: true
      },
      globals: {
        document: 'readonly',
        window: 'readonly'
      }
    }
  ]
};
