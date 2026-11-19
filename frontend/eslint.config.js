import vue from 'eslint-plugin-vue'
import globals from 'globals'

/** Cổng lint cho Web: kiểm tra identifier, import và template, không thay logic tự động. */
export default [
  ...vue.configs['flat/essential'],
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-dupe-class-members': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
    },
  },
]
