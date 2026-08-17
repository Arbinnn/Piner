// Bundles the Vercel serverless handler into plain-JS function files. Vercel's Node builder
// transpiles TypeScript file-by-file without bundling and without rewriting relative import
// specifiers, so multi-file `.ts` sources with extension-ful imports (`./app.ts`) 404 at
// runtime. Bundling here sidesteps that entirely — each output file is self-contained.
//
// One file per route, not a `[...path]` catch-all: catch-all dynamic segments are a Next.js
// routing convention. On a plain Vite project Vercel's build output only ever generates a
// single-path-segment route for `[...path].js` (`^/api/([^/]+)$`), so a two-segment route like
// `/api/pine/execute` never matched and 404'd. `handleRequest` already routes internally on
// `req.url`, so every one of these files can share the exact same bundle — which physical file
// Vercel invokes doesn't matter.
import { build } from 'esbuild';

const routes = ['api/health.js', 'api/candles.js', 'api/pine/execute.js'];

await Promise.all(
  routes.map((outfile) =>
    build({
      entryPoints: ['server/vercel-handler.ts'],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      // Real npm dependencies stay external — Vercel installs node_modules for the function,
      // and server/pine/cache.ts resolves @heyphat/piner's on-disk package.json for its
      // version string.
      external: ['@heyphat/piner'],
    }),
  ),
);
