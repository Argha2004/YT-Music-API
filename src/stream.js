import { DEFAULT_USER_AGENT } from './config.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';

const execFileAsync = promisify(execFile);

// In-memory cache for resolved audio stream URLs
// videoId -> { url, httpHeaders, mimeType, expiresAt }
const streamCache = new Map();

/**
 * Fallback: pipe raw audio bytes directly from yt-dlp child process.
 * Guarantees streaming succeeds even if direct GoogleVideo CDN fetch is rejected.
 */
function streamViaProcess(req, res, videoId, mimeType = 'audio/mp4') {
  if (res.headersSent) return;

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'Accept-Ranges': 'none',
  });

  const proc = spawn('yt-dlp', [
    '--no-warnings',
    '--no-playlist',
    '--extractor-args', 'youtube:player_client=android',
    '-f', 'bestaudio/best/18',
    '-o', '-',
    `https://music.youtube.com/watch?v=${videoId}`,
  ]);

  proc.stdout.pipe(res);

  proc.on('error', (err) => {
    console.error(`[yt-dlp spawn error] ${videoId}:`, err.message);
    if (!res.destroyed) res.destroy();
  });

  req.on('close', () => {
    if (!proc.killed) proc.kill();
  });
}

/**
 * Resolve direct audio stream URL and necessary request headers.
 * Uses yt-dlp with STRICTLY the android player client which bypasses YouTube's 403 BotGuard/PO-Token blocks.
 */
export async function resolveAudioFormat(videoId, forceFresh = false) {
  if (!forceFresh) {
    const cached = streamCache.get(videoId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached;
    }
  }

  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--no-warnings',
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=android',
      '-j',
      '-f', 'bestaudio/best/18',
      `https://music.youtube.com/watch?v=${videoId}`,
    ]);

    const info = JSON.parse(stdout);
    const streamUrl = info.url;

    if (!streamUrl) {
      const err = new Error('No valid audio stream URL was found for this track.');
      err.statusCode = 404;
      throw err;
    }

    // Determine mimeType
    let mimeType = 'audio/mp4';
    if (info.ext === 'mp4' || info.ext === 'm4a') {
      mimeType = 'audio/mp4';
    } else if (info.ext === 'webm') {
      mimeType = 'audio/webm';
    } else if (info.ext === 'mp3') {
      mimeType = 'audio/mpeg';
    }

    // Parse expiration
    let expiresAt = Date.now() + 4 * 60 * 60 * 1000; // default 4 hours
    const expireMatch = streamUrl.match(/[?&]expire=(\d+)/);
    if (expireMatch) {
      const sec = Number(expireMatch[1]);
      if (sec > 0) expiresAt = sec * 1000 - 10 * 60 * 1000;
    }

    const entry = {
      videoId,
      url: streamUrl,
      httpHeaders: info.http_headers || { 'User-Agent': DEFAULT_USER_AGENT },
      mimeType,
      expiresAt,
    };

    streamCache.set(videoId, entry);
    return entry;
  } catch (err) {
    const message = err.message || '';
    if (/unavailable|not available|private video|copyright/i.test(message)) {
      const notFound = new Error(`Track ${videoId} is unavailable, private, or does not exist on YouTube Music.`);
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }
}

/**
 * Proxy audio stream with full HTTP Range (206 Partial Content) support.
 * The server pipes stream chunks from googlevideo to the client with authentic headers,
 * falling back to direct process streaming if the CDN refuses the connection.
 */
export async function proxyAudioStream(req, res, videoId) {
  try {
    let format = await resolveAudioFormat(videoId);
    const rangeHeader = req.headers['range'];

    let upstreamHeaders = {
      ...format.httpHeaders,
    };
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    let upstreamRes = await fetch(format.url, {
      headers: upstreamHeaders,
    });

    // If upstream returns 403 (expired or CDN restriction), retry fresh extraction
    if (upstreamRes.status === 403) {
      streamCache.delete(videoId);
      try {
        format = await resolveAudioFormat(videoId, true);
        upstreamHeaders = {
          ...format.httpHeaders,
        };
        if (rangeHeader) {
          upstreamHeaders['Range'] = rangeHeader;
        }
        upstreamRes = await fetch(format.url, {
          headers: upstreamHeaders,
        });
      } catch {
        // Fall back to direct process streaming if resolution fails
        return streamViaProcess(req, res, videoId, format.mimeType);
      }
    }

    // If still 403 or error, fall back to direct process stream
    if (upstreamRes.status === 403 || !upstreamRes.ok && upstreamRes.status !== 206) {
      console.warn(`[Stream] Upstream CDN returned ${upstreamRes.status}. Falling back to direct process stream for ${videoId}...`);
      return streamViaProcess(req, res, videoId, format.mimeType);
    }

    const responseHeaders = {
      'Content-Type': upstreamRes.headers.get('content-type') || format.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };

    const contentRange = upstreamRes.headers.get('content-range');
    const contentLength = upstreamRes.headers.get('content-length');

    if (contentRange) responseHeaders['Content-Range'] = contentRange;
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    res.writeHead(upstreamRes.status, responseHeaders);

    // Pipe audio stream to client safely handling disconnects/pauses
    if (upstreamRes.body) {
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.on('error', () => {
        if (!res.destroyed) res.destroy();
      });
      req.on('close', () => {
        nodeStream.destroy();
      });
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    const status = error.statusCode || 500;
    console.error(`[Stream Error] ${videoId}:`, error.message);
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message, videoId }));
    }
  }
}
