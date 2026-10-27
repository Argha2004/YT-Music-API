import { ENDPOINTS, DEFAULT_CLIENT, SEARCH_PARAMS, BASE_URL } from './config.js';
import { buildAuthHeaders, fetchMusicContext } from './auth.js';

// ---------------------------------------------------------------- Utils

/** Walk nested JSON tree and visit all nodes */
export function walkObjects(root, visitor) {
  if (!root || typeof root !== 'object') return;
  if (Array.isArray(root)) {
    root.forEach((item) => walkObjects(item, visitor));
    return;
  }
  visitor(root);
  Object.values(root).forEach((val) => walkObjects(val, visitor));
}

/** Flatten runs array into string */
export function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.simpleText) return String(value.simpleText);
  if (Array.isArray(value.runs)) return value.runs.map((r) => r.text || '').join('');
  return '';
}

/** Upgrade thumbnail image size */
export function largerThumbnail(url) {
  if (!url) return null;
  return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^&?]*$/, '=w544-h544-l90-rj') : url;
}

/** Extract highest resolution thumbnail */
export function extractThumbnail(container) {
  if (!container) return null;
  const list =
    container.thumbnails ||
    container.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    container.thumbnail?.thumbnails ||
    [];
  if (!list.length) return null;
  return largerThumbnail(list[list.length - 1]?.url);
}

/** "3:45" or "1:02:15" -> duration in seconds */
export function parseDuration(text) {
  const s = String(text || '').trim();
  if (!/^(?:\d+:)?\d{1,2}:\d{2}$/.test(s)) return null;
  return s
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

// ---------------------------------------------------------------- Item Parsers

/** Extract runs from flex columns */
function columnRuns(renderer, idx) {
  return renderer?.flexColumns?.[idx]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
}

/** Parse song and video items from responsive list items */
export function parseResponsiveItem(renderer) {
  const titleRuns = columnRuns(renderer, 0);
  const watch =
    titleRuns[0]?.navigationEndpoint?.watchEndpoint ||
    renderer?.navigationEndpoint?.watchEndpoint;
  const videoId = renderer?.playlistItemData?.videoId || watch?.videoId;

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;

  const subtitleRuns = [
    ...(renderer.flexColumns || []).slice(1).flatMap((_, i) => columnRuns(renderer, i + 1)),
    ...(renderer.fixedColumns || []).flatMap(
      (c) => c.musicResponsiveListItemFixedColumnRenderer?.text?.runs || []
    ),
  ];

  const artists = [];
  let album = null;
  let albumId = null;
  let duration = null;

  for (const run of subtitleRuns) {
    const text = String(run.text || '').trim();
    if (!text || text === '•') continue;
    const browse = run.navigationEndpoint?.browseEndpoint;
    const pageType =
      browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';

    if (pageType.endsWith('_ARTIST') || pageType.endsWith('_USER_CHANNEL')) {
      artists.push({ name: text, id: browse?.browseId || null });
    } else if (pageType.endsWith('_ALBUM') || /^MPRE/.test(browse?.browseId || '')) {
      album = text;
      albumId = browse?.browseId || null;
    } else if (parseDuration(text) != null) {
      duration = parseDuration(text);
    }
  }

  const thumb = extractThumbnail(renderer.thumbnail);

  return {
    id: videoId,
    title: titleRuns.map((r) => r.text).join('').trim(),
    artists: artists.length ? artists : [{ name: subtitleRuns[0]?.text || 'Unknown Artist', id: null }],
    artist: artists.map((a) => a.name).join(', ') || subtitleRuns[0]?.text || 'Unknown Artist',
    album: album || null,
    albumId: albumId || null,
    duration,
    durationText: duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : null,
    thumbnail: thumb,
    url: `${BASE_URL}/watch?v=${videoId}`,
    shareUrl: `https://youtu.be/${videoId}`,
    streamUrl: `/api/stream/${videoId}`,
  };
}

// ---------------------------------------------------------------- Core Requests

/** Make an authenticated or anonymous Innertube POST request */
export async function innertubeRequest(endpointUrl, body = {}, cookieHeader = '') {
  const context = await fetchMusicContext(cookieHeader);
  const headers = buildAuthHeaders(cookieHeader, context);

  const payload = {
    context: {
      client: {
        ...DEFAULT_CLIENT,
        clientVersion: context.clientVersion,
        ...(context.visitorData ? { visitorData: context.visitorData } : {}),
      },
    },
    ...body,
  };

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`YouTube Music Innertube request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

// ---------------------------------------------------------------- Search

export async function search({ query, filter = 'songs', limit = 20, cookie = '' }) {
  const params = SEARCH_PARAMS[filter.toLowerCase()] || SEARCH_PARAMS.songs;
  const json = await innertubeRequest(ENDPOINTS.SEARCH, { query, params }, cookie);

  const results = [];
  const seen = new Set();

  walkObjects(json, (node) => {
    if (node.musicResponsiveListItemRenderer) {
      const item = parseResponsiveItem(node.musicResponsiveListItemRenderer);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        results.push(item);
      }
    }
  });

  return {
    query,
    filter,
    total: results.length,
    results: results.slice(0, Number(limit) || 20),
  };
}

// ---------------------------------------------------------------- Browse

export async function browse({ browseId, params, continuation, cookie = '' }) {
  const body = {
    browseId,
    ...(params ? { params } : {}),
    ...(continuation ? { continuation } : {}),
  };

  return innertubeRequest(ENDPOINTS.BROWSE, body, cookie);
}

// ---------------------------------------------------------------- Playlists

export async function getPlaylist({ playlistId, limit = 100, cookie = '' }) {
  const cleanId = String(playlistId || '').replace(/^VL/, '');
  const json = await browse({ browseId: `VL${cleanId}`, cookie });

  let title = 'Playlist';
  let author = null;
  let thumbnail = null;

  walkObjects(json, (node) => {
    const header =
      node.musicDetailHeaderRenderer ||
      node.musicEditablePlaylistDetailHeaderRenderer ||
      node.musicResponsiveHeaderRenderer;
    if (header) {
      if (!title || title === 'Playlist') title = textOf(header.title) || title;
      if (!author) author = textOf(header.subtitle || header.straplineTextOne || header.ownerText);
      if (!thumbnail) thumbnail = extractThumbnail(header.thumbnail || header.image);
    }
  });

  const tracks = [];
  const seen = new Set();

  walkObjects(json, (node) => {
    if (node.musicResponsiveListItemRenderer) {
      const track = parseResponsiveItem(node.musicResponsiveListItemRenderer);
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        tracks.push(track);
      }
    }
  });

  return {
    id: cleanId,
    title,
    author,
    thumbnail,
    trackCount: tracks.length,
    tracks: tracks.slice(0, Number(limit) || 100),
  };
}

// ---------------------------------------------------------------- Albums

export async function getAlbum({ albumId, cookie = '' }) {
  const json = await browse({ browseId: albumId, cookie });

  let title = null;
  let artist = null;
  let year = null;
  let thumbnail = null;

  walkObjects(json, (node) => {
    const header = node.musicDetailHeaderRenderer || node.musicResponsiveHeaderRenderer;
    if (header) {
      if (!title) title = textOf(header.title);
      if (!artist) artist = textOf(header.subtitle || header.straplineTextOne);
      if (!thumbnail) thumbnail = extractThumbnail(header.thumbnail || header.image);
    }
  });

  const tracks = [];
  const seen = new Set();

  walkObjects(json, (node) => {
    if (node.musicResponsiveListItemRenderer) {
      const track = parseResponsiveItem(node.musicResponsiveListItemRenderer);
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        tracks.push(track);
      }
    }
  });

  return {
    id: albumId,
    title: title || 'Album',
    artist: artist || 'Unknown Artist',
    year,
    thumbnail,
    trackCount: tracks.length,
    tracks,
  };
}

// ---------------------------------------------------------------- Artists

export async function getArtist({ artistId, cookie = '' }) {
  const json = await browse({ browseId: artistId, cookie });

  let name = null;
  let description = null;
  let thumbnail = null;

  walkObjects(json, (node) => {
    const header = node.musicImmersiveHeaderRenderer || node.musicVisualHeaderRenderer;
    if (header) {
      if (!name) name = textOf(header.title);
      if (!description) description = textOf(header.description);
      if (!thumbnail) thumbnail = extractThumbnail(header.thumbnail);
    }
  });

  const topSongs = [];
  const seen = new Set();

  walkObjects(json, (node) => {
    if (node.musicResponsiveListItemRenderer && topSongs.length < 10) {
      const track = parseResponsiveItem(node.musicResponsiveListItemRenderer);
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        topSongs.push(track);
      }
    }
  });

  return {
    id: artistId,
    name: name || 'Artist',
    description,
    thumbnail,
    topSongs,
  };
}

// ---------------------------------------------------------------- Radio & Recommendations

export async function getRadio({ videoId, limit = 25, cookie = '' }) {
  const json = await innertubeRequest(
    ENDPOINTS.NEXT,
    {
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    },
    cookie
  );

  const tracks = [];
  const seen = new Set();

  walkObjects(json, (node) => {
    if (node.playlistPanelVideoRenderer) {
      const v = node.playlistPanelVideoRenderer;
      const id = v.videoId;
      if (id && /^[\w-]{11}$/.test(id) && !seen.has(id)) {
        seen.add(id);
        tracks.push({
          id,
          title: textOf(v.title),
          artist: textOf(v.shortBylineText || v.longBylineText),
          duration: parseDuration(textOf(v.lengthText)),
          durationText: textOf(v.lengthText),
          thumbnail: extractThumbnail(v.thumbnail),
          url: `${BASE_URL}/watch?v=${id}`,
          streamUrl: `/api/stream/${id}`,
        });
      }
    }
  });

  return {
    seedVideoId: videoId,
    total: tracks.length,
    tracks: tracks.slice(0, Number(limit) || 25),
  };
}

// ---------------------------------------------------------------- Account Surfaces

export async function getAccountLiked({ limit = 100, cookie = '' }) {
  return getPlaylist({ playlistId: 'VLLM', limit, cookie });
}

export async function getAccountHistory({ limit = 100, cookie = '' }) {
  const json = await browse({ browseId: 'FEmusic_history', cookie });
  const tracks = [];
  const seen = new Set();

  walkObjects(json, (node) => {
    if (node.musicResponsiveListItemRenderer) {
      const item = parseResponsiveItem(node.musicResponsiveListItemRenderer);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        tracks.push(item);
      }
    }
  });

  return {
    title: 'History',
    total: tracks.length,
    tracks: tracks.slice(0, Number(limit) || 100),
  };
}

export async function setTrackLiked({ videoId, liked = true, cookie = '' }) {
  const endpoint = liked ? ENDPOINTS.LIKE : ENDPOINTS.REMOVE_LIKE;
  const json = await innertubeRequest(
    endpoint,
    {
      target: { videoId },
    },
    cookie
  );

  return {
    success: true,
    videoId,
    liked: !!liked,
    response: json,
  };
}
