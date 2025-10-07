export default {
  // Run Prettier on all supported file types
  "*.{js,jsx,ts,tsx,json,css,scss,md,html}": ["prettier --write"],
  // Run ESLint on JavaScript/TypeScript files with cache for performance
  "*.{js,jsx,ts,tsx}": ["eslint --cache --cache-location .eslintcache --fix", "eslint --cache --cache-location .eslintcache"],
};
