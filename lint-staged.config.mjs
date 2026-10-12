export default {
  '*.{ts,tsx,mjs,json,md,yml,yaml,css}': 'prettier --check',
  '*': () => 'npm run verify',
};
