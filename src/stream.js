import { DEFAULT_USER_AGENT } from './config.js';
import { Readable } from 'node:stream';
import { Innertube, ClientType } from 'youtubei.js';

// In-memory cache for resolved audio stream URLs
// videoId -> { url, httpHeaders, mimeType, contentLength, expiresAt }
const streamCache = new Map();

// Singleton Innertube client instance (iOS client profile provides direct, unthrottled audio URLs with no cipher)
let innertubePromise = null;

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      client_type: ClientType.IOS,
      retrieve_player: false,
    }).catch((err) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

/**
 * Resolve direct audio stream URL and necessary request headers using pure JavaScript (Innertube iOS client).
 * Runs natively in Node.js and Serverless runtimes (Vercel, AWS Lambda) without requiring external binaries like yt-dlp.
 */
export async function resolveAudioFormat(videoId, forceFresh = false) {
  if (!forceFresh) {
    const cached = streamCache.get(videoId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached;
    }
  }

  try {
    const yt = await getInnertube();
    const info = await yt.getBasicInfo(videoId);

    const formats = info.streaming_data?.adaptive_formats || [];
    const audioFormats = formats.filter((f) => f.has_audio && !f.has_video);

    if (audioFormats.length === 0) {
      const err = new Error(`No valid audio stream was found for track ${videoId}.`);
      err.statusCode = 404;
      throw err;
    }

    // Sort by bitrate descending (highest audio quality, typically 128kbps AAC / m4a itag 140)
    audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const bestAudio = audioFormats[0];

    const streamUrl = bestAudio.url;
    if (!streamUrl) {
      const err = new Error(`Audio stream URL could not be resolved for track ${videoId}.`);
      err.statusCode = 404;
      throw err;
    }

    const mimeType = bestAudio.mime_type?.split(';')[0] || 'audio/mp4';

    // Parse expiration from URL parameter (default 4 hours)
    let expiresAt = Date.now() + 4 * 60 * 60 * 1000;
    const expireMatch = streamUrl.match(/[?&]expire=(\d+)/);
    if (expireMatch) {
      const sec = Number(expireMatch[1]);
      if (sec > 0) expiresAt = sec * 1000 - 10 * 60 * 1000;
    }

    const entry = {
      videoId,
      url: streamUrl,
      httpHeaders: {
        'User-Agent':
          'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X; en_US)',
        Referer: 'https://music.youtube.com/',
      },
      mimeType,
      bitrate: bestAudio.bitrate,
      contentLength: bestAudio.content_length,
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
 * Also supports 302 direct redirect if `?redirect=true` or `?direct=true` is requested.
 */
export async function proxyAudioStream(req, res, videoId) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const shouldRedirect = urlObj.searchParams.get('redirect') === 'true' || urlObj.searchParams.get('direct') === 'true';

    let format = await resolveAudioFormat(videoId);

    // If client requested a direct URL / redirect, return 302 Found
    if (shouldRedirect) {
      res.writeHead(302, {
        Location: format.url,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end();
    }

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

    // If expired or CDN returns 403, retry with fresh format
    if (upstreamRes.status === 403) {
      streamCache.delete(videoId);
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
    }

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      throw new Error(`Upstream audio fetch failed with status ${upstreamRes.status}`);
    }

    const responseHeaders = {
      'Content-Type': upstreamRes.headers.get('content-type') || format.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=14400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    };

    const contentRange = upstreamRes.headers.get('content-range');
    const contentLength = upstreamRes.headers.get('content-length');

    if (contentRange) responseHeaders['Content-Range'] = contentRange;
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    res.writeHead(upstreamRes.status, responseHeaders);

    // Pipe audio stream to client safely handling disconnects
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
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: error.message, videoId }));
    }
  }
}
