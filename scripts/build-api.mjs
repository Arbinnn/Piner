// Bundles the Vercel serverless handler into one plain-JS file. Vercel's Node builder
// transpiles TypeScript file-by-file without bundling and without rewriting relative import
// specifiers, so multi-file `.ts` sources with extension-ful imports (`./app.ts`) 404 at
// runtime. Bundling here sidesteps that entirely — `api/[...path].js` is self-contained.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/vercel-handler.ts'],
  outfile: 'api/[...path].js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Real npm dependencies stay external — Vercel installs node_modules for the function, and
  // server/pine/cache.ts resolves @heyphat/piner's on-disk package.json for its version string.
  external: ['@heyphat/piner'],
});
