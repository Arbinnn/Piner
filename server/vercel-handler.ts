/**
 * Vercel serverless entry point. Catches every `/api/*` request and hands it to the same
 * handler `server/index.ts` uses locally — no separate routing logic to keep in sync.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../server/app.ts';

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleRequest(req, res);
}
