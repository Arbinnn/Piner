/**
 * Local dev entry point for the Pine backend — `node:http` wired to `handleRequest`.
 *
 * In development Vite proxies `/api` here (see vite.config.ts), so the browser talks to one
 * origin and there is no CORS to configure. In production (Vercel) `api/[...path].ts` calls
 * `handleRequest` directly instead — no standalone process there.
 */

import { createServer } from 'node:http';
import { handleRequest } from './app.ts';

const PORT = Number(process.env.PORT ?? 3001);

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`[pine] execution service listening on http://localhost:${PORT}`);
});
