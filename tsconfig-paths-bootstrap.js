/**
 * Bootstrap tsconfig-paths pour la production.
 * Utilisé via : node -r ./tsconfig-paths-bootstrap dist/main
 *
 * En dev (nest start --watch), ts-node résout les paths via tsconfig.json directement.
 * En prod (node dist/main), les fichiers sont dans dist/ donc on remplace baseUrl.
 */
const { register } = require('tsconfig-paths');
const { compilerOptions } = require('./tsconfig.json');

register({
  baseUrl: './dist',
  paths: compilerOptions.paths,
});
