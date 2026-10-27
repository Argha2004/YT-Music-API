import crypto from 'node:crypto';
import { DEFAULT_CLIENT, DEFAULT_USER_AGENT, BASE_URL } from './config.js';

let cachedContext = null;
let contextExpiry = 0;

/** Extract individual cookie by name from cookie header string */
export function getCookie(cookieHeader, names) {
  if (!cookieHeader) return '';
  const search = Array.isArray(names) ? names : [names];
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (search.includes(key)) {
      return part.slice(idx + 1).trim();
    }
  }
  return '';
}

/**
 * Mint the SAPISID authorization headers required for authenticated YouTube Music requests.
 * Uses SAPISID, __Secure-3PAPISID, or __Secure-1PAPISID with timestamp SHA1 signature.
 */
export function buildAuthHeaders(cookieHeader = '', customContext = {}) {
  const cookie = String(cookieHeader || process.env.YTMUSIC_COOKIE || '').trim();
  const sapisid = getCookie(cookie, ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID']);

  const headers = {
    'Content-Type': 'application/json',
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    'X-Origin': BASE_URL,
    'X-YouTube-Client-Name': '67', // 67 = WEB_REMIX
    'X-YouTube-Client-Version': customContext.clientVersion || DEFAULT_CLIENT.clientVersion,
    'User-Agent': DEFAULT_USER_AGENT,
  };

  if (cookie) {
    headers['Cookie'] = cookie;
  }

  if (sapisid) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = (val) =>
      `${timestamp}_${crypto.createHash('sha1').update(`${timestamp} ${val} ${BASE_URL}`).digest('hex')}`;

    const authTokens = [`SAPISIDHASH ${sign(sapisid)}`];

    const sapisid1p = getCookie(cookie, ['__Secure-1PAPISID']);
    if (sapisid1p) authTokens.push(`SAPISID1PHASH ${sign(sapisid1p)}`);

    const sapisid3p = getCookie(cookie, ['__Secure-3PAPISID']);
    if (sapisid3p) authTokens.push(`SAPISID3PHASH ${sign(sapisid3p)}`);

    headers['Authorization'] = authTokens.join(' ');
  }

  if (customContext.visitorData) {
    headers['X-Goog-Visitor-Id'] = customContext.visitorData;
  }

  return headers;
}

/**
 * Retrieve current visitor data and Innertube client config directly from YouTube Music web
 */
export async function fetchMusicContext(cookieHeader = '') {
  if (cachedContext && Date.now() < contextExpiry) {
    return cachedContext;
  }

  try {
    const res = await fetch(`${BASE_URL}/`, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    if (res.ok) {
      const html = await res.text();
      const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
      const visitorMatch = html.match(/"VISITOR_DATA":"([^"]+)"/);

      cachedContext = {
        clientVersion: clientVersionMatch ? clientVersionMatch[1] : DEFAULT_CLIENT.clientVersion,
        visitorData: visitorMatch ? visitorMatch[1] : null,
      };
      contextExpiry = Date.now() + 6 * 60 * 60 * 1000; // 6 hours
      return cachedContext;
    }
  } catch (err) {
    console.warn('[Auth] Failed to refresh live music context:', err.message);
  }

  return {
    clientVersion: DEFAULT_CLIENT.clientVersion,
    visitorData: null,
  };
}
