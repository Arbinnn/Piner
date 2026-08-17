/**
 * Vercel serverless entry point. Catches every `/api/*` request and hands it to the same
 * handler `server/index.ts` uses locally — no separate routing logic to keep in sync.
 *
 * Vercel's Node builder does not bundle multi-file TypeScript projects — it transpiles each
 * `.ts` file individually and leaves relative import specifiers untouched, so an import like
 * `./app.ts` fails at runtime looking for a file that was never emitted. `scripts/build-api.mjs`
 * bundles this file (and everything it imports) into a single `api/[...path].js` at build time,
 * so this source file is never deployed as-is — only its bundled output is.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from './app.ts';

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleRequest(req, res);
}
