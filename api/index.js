import { handleRequest } from '../src/routes.js';

export default async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('[Vercel Handler Error]:', err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
    }
  }
}
