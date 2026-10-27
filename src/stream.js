import { Readable } from 'node:stream';
import { Innertube, ClientType } from 'youtubei.js';

// In-memory cache for resolved audio stream URLs
// videoId -> { url, httpHeaders, mimeType, contentLength, expiresAt, client }
const streamCache = new Map();

// Client instances cache
const clientCache = new Map();

// Multi-client fallback chain
// If one client profile is blocked or restricted by YouTube on datacenter IPs (e.g. AWS/Vercel),
// the resolver automatically falls back to the next client candidate.
const CLIENT_CANDIDATES = [
  {
    type: ClientType.IOS,
    name: 'iOS',
    userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X; en_US)',
  },
  {
    type: ClientType.ANDROID_VR,
    name: 'Android VR',
    userAgent: 'Mozilla/5.0 (Linux; Android 12; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  },
  {
    type: ClientType.VISIONOS,
    name: 'visionOS',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  },
];

async function getInnertubeClient(clientType, cookie = '') {
  const cacheKey = `${clientType}_${cookie ? 'auth' : 'anon'}`;
  if (!clientCache.has(cacheKey)) {
    const promise = Innertube.create({
      client_type: clientType,
      retrieve_player: false,
      cookie: cookie || process.env.YT_COOKIE || undefined,
    }).catch((err) => {
      clientCache.delete(cacheKey);
      throw err;
    });
    clientCache.set(cacheKey, promise);
  }
  return clientCache.get(cacheKey);
}

/**
 * Resolve direct audio stream URL and headers with automatic multi-client fallback.
 * Works natively in Node.js and Serverless runtimes (Vercel, AWS Lambda) without yt-dlp.
 */
export async function resolveAudioFormat(videoId, forceFresh = false, cookie = '') {
  if (!forceFresh) {
    const cached = streamCache.get(videoId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached;
    }
  }

  const diagnostics = [];

  for (const candidate of CLIENT_CANDIDATES) {
    try {
      const yt = await getInnertubeClient(candidate.type, cookie);
      const info = await yt.getBasicInfo(videoId);

      const playability = info.playability_status?.status;
      if (playability && playability !== 'OK') {
        diagnostics.push(`${candidate.name}: ${playability} (${info.playability_status?.reason || 'restricted'})`);
        continue;
      }

      const adaptive = info.streaming_data?.adaptive_formats || [];
      const progressive = info.streaming_data?.formats || [];

      // 1. Audio-only adaptive formats with direct stream URL
      let audios = adaptive.filter((f) => f.has_audio && !f.has_video && f.url);

      // 2. Fallback to progressive muxed formats with direct stream URL
      if (audios.length === 0) {
        audios = progressive.filter((f) => f.has_audio && f.url);
      }

      if (audios.length === 0) {
        diagnostics.push(`${candidate.name}: 0 direct audio URLs`);
        continue;
      }

      // Sort by bitrate descending for highest audio fidelity
      audios.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const bestAudio = audios[0];
      const streamUrl = bestAudio.url;

      const mimeType = bestAudio.mime_type?.split(';')[0] || 'audio/mp4';

      let expiresAt = Date.now() + 4 * 60 * 60 * 1000;
      const expireMatch = streamUrl.match(/[?&]expire=(\d+)/);
      if (expireMatch) {
        const sec = Number(expireMatch[1]);
        if (sec > 0) expiresAt = sec * 1000 - 10 * 60 * 1000;
      }

      const entry = {
        videoId,
        client: candidate.name,
        url: streamUrl,
        httpHeaders: {
          'User-Agent': candidate.userAgent,
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
      diagnostics.push(`${candidate.name}: ${err.message || 'fetch error'}`);
    }
  }

  const err = new Error(
    `No valid audio stream was found for track ${videoId}. Diagnostics: [${diagnostics.join('; ')}]`
  );
  err.statusCode = 404;
  err.diagnostics = diagnostics;
  throw err;
}

/**
 * Proxy audio stream with full HTTP Range (206 Partial Content) support.
 * Also supports 302 direct redirect if `?redirect=true` or `?direct=true` is requested.
 */
export async function proxyAudioStream(req, res, videoId, cookie = '') {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const shouldRedirect = urlObj.searchParams.get('redirect') === 'true' || urlObj.searchParams.get('direct') === 'true';

    let format = await resolveAudioFormat(videoId, false, cookie);

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
      format = await resolveAudioFormat(videoId, true, cookie);
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
      if (typeof req.on === 'function') req.on('close', () => {
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
      res.end(JSON.stringify({
        error: error.message,
        videoId,
        diagnostics: error.diagnostics || undefined,
      }));
    }
  }
}
