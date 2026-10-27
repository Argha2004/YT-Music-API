import fs from 'node:fs';
import { URL } from 'node:url';
import * as innertube from './innertube.js';
import { proxyAudioStream } from './stream.js';

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-yt-cookie, Range',
  });
  res.end(JSON.stringify(data, null, 2));
}

function getCookieFromReq(req) {
  return req.headers['x-yt-cookie'] || req.headers['cookie'] || '';
}

export async function handleRequest(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-yt-cookie, Range',
    });
    res.end();
    return;
  }

  // On Vercel rewrites, the original requested path is passed in x-matched-path
  const matchedPath = req.headers['x-matched-path'];
  const searchIndex = req.url.indexOf('?');
  const searchParams = searchIndex !== -1 ? req.url.slice(searchIndex) : '';
  const effectiveUrl = matchedPath
    ? (matchedPath.includes('?') ? matchedPath : `${matchedPath}${searchParams}`)
    : req.url;

  const parsedUrl = new URL(
    effectiveUrl,
    `http://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost'}`
  );
  const pathname = parsedUrl.pathname;
  const cookie = getCookieFromReq(req);

  try {
    // 1. Health check
    if (pathname === '/health') {
      return sendJson(res, 200, {
        status: 'online',
        service: 'YouTube Music REST API',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Interactive Playground UI (/), Dedicated Detailed Docs (/docs), and About Page (/about)
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderPlaygroundPage());
    }

    if (pathname === '/docs') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderDocsPage());
    }

    if (pathname === '/about') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderAboutPage());
    }

    if (pathname === '/terms') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderTermsPage());
    }

    // 3. Search API: /api/search?q=query&filter=songs|albums|artists|playlists&limit=20
    if (pathname === '/api/search') {
      const q = parsedUrl.searchParams.get('q');
      if (!q) return sendJson(res, 400, { error: 'Missing required query parameter: q' });
      const filter = parsedUrl.searchParams.get('filter') || 'songs';
      const limit = Number(parsedUrl.searchParams.get('limit') || 20);

      const results = await innertube.search({ query: q, filter, limit, cookie });
      return sendJson(res, 200, results);
    }

    // 4. Radio / Song Recommendations: /api/radio/:id
    const radioMatch = pathname.match(/^\/api\/radio\/([\w-]{11})$/);
    if (radioMatch) {
      const videoId = radioMatch[1];
      const limit = Number(parsedUrl.searchParams.get('limit') || 25);
      const data = await innertube.getRadio({ videoId, limit, cookie });
      return sendJson(res, 200, data);
    }

    // 5. Playlist Details & Tracks: /api/playlists/:id
    const playlistMatch = pathname.match(/^\/api\/playlists\/([\w.-]+)$/);
    if (playlistMatch) {
      const playlistId = playlistMatch[1];
      const limit = Number(parsedUrl.searchParams.get('limit') || 100);
      const data = await innertube.getPlaylist({ playlistId, limit, cookie });
      return sendJson(res, 200, data);
    }

    // 6. Album Details: /api/albums/:id
    const albumMatch = pathname.match(/^\/api\/albums\/([\w.-]+)$/);
    if (albumMatch) {
      const albumId = albumMatch[1];
      const data = await innertube.getAlbum({ albumId, cookie });
      return sendJson(res, 200, data);
    }

    // 7. Artist Profile: /api/artists/:id
    const artistMatch = pathname.match(/^\/api\/artists\/([\w.-]+)$/);
    if (artistMatch) {
      const artistId = artistMatch[1];
      const data = await innertube.getArtist({ artistId, cookie });
      return sendJson(res, 200, data);
    }

    // 8. Stream Audio Proxy: /api/stream/:id
    const streamMatch = pathname.match(/^\/api\/stream\/([\w-]{11})$/);
    if (streamMatch) {
      const videoId = streamMatch[1];
      return proxyAudioStream(req, res, videoId);
    }

    // 9. Account: Liked Songs
    if (pathname === '/api/account/liked') {
      const limit = Number(parsedUrl.searchParams.get('limit') || 100);
      const data = await innertube.getAccountLiked({ limit, cookie });
      return sendJson(res, 200, data);
    }

    // 10. Account: Playback History
    if (pathname === '/api/account/history') {
      const limit = Number(parsedUrl.searchParams.get('limit') || 100);
      const data = await innertube.getAccountHistory({ limit, cookie });
      return sendJson(res, 200, data);
    }

    // 11. Account: Like / Unlike Track
    const likeMatch = pathname.match(/^\/api\/account\/like\/([\w-]{11})$/);
    if (likeMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      const videoId = likeMatch[1];
      const liked = req.method === 'POST';
      const data = await innertube.setTrackLiked({ videoId, liked, cookie });
      return sendJson(res, 200, data);
    }

    // 404 Route Not Found
    return sendJson(res, 404, {
      error: 'Endpoint not found',
      path: pathname,
      docs: '/docs',
      about: '/about',
      terms: '/terms',
      playground: '/',
    });
  } catch (error) {
    console.error(`[API Error] ${pathname}:`, error);
    return sendJson(res, 500, {
      error: error.message || 'Internal server error',
    });
  }
}

function renderDocsPage() {
  const docsHtmlPath = new URL('./docs.html', import.meta.url);
  return fs.readFileSync(docsHtmlPath, 'utf8');
}

function renderAboutPage() {
  const aboutHtmlPath = new URL('./about.html', import.meta.url);
  return fs.readFileSync(aboutHtmlPath, 'utf8');
}

function renderTermsPage() {
  const termsHtmlPath = new URL('./terms.html', import.meta.url);
  return fs.readFileSync(termsHtmlPath, 'utf8');
}

function renderPlaygroundPage() {
  const indexHtmlPath = new URL('./index.html', import.meta.url);
  return fs.readFileSync(indexHtmlPath, 'utf8');
}
