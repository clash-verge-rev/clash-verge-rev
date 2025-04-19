import unusedImports from 'eslint-plugin-unused-imports';

export default [
  {
    plugins: {
      'unused-imports': unusedImports
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', 
        { 'vars': 'all', 'varsIgnorePattern': '^_', 'args': 'after-used', 'argsIgnorePattern': '^_' }
      ],
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }
  }
];
