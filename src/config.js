// Configuration for YouTube Music API and Server
export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';

export const BASE_URL = 'https://music.youtube.com';
export const INNERTUBE_BASE = `${BASE_URL}/youtubei/v1`;

export const ENDPOINTS = {
  SEARCH: `${INNERTUBE_BASE}/search?prettyPrint=false`,
  BROWSE: `${INNERTUBE_BASE}/browse?prettyPrint=false`,
  NEXT: `${INNERTUBE_BASE}/next?prettyPrint=false`,
  LIKE: `${INNERTUBE_BASE}/like?prettyPrint=false`,
  REMOVE_LIKE: `${INNERTUBE_BASE}/like/removelike?prettyPrint=false`,
  PLAYER: `${INNERTUBE_BASE}/player?prettyPrint=false`,
};

// YouTube Music client profile (WEB_REMIX)
export const DEFAULT_CLIENT = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20250901.03.00',
  hl: 'en',
  gl: 'US',
};

// Filter params for the /youtubei/v1/search endpoint
export const SEARCH_PARAMS = {
  songs: 'EgWKAQIIAWoOEAkQAxAEEAUQChAVEA4%3D',
  albums: 'EgWKAQIBAWoOEAkQAxAEEAUQChAVEA4%3D',
  artists: 'EgWKAQIgAWoOEAkQAxAEEAUQChAVEA4%3D',
  playlists: 'EgWKAQIoAWoOEAkQAxAEEAUQChAVEA4%3D',
  videos: 'EgWKAQIQAWoOEAkQAxAEEAUQChAVEA4%3D',
};

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
