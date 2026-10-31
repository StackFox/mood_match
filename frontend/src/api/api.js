/**
 * API helper — all calls to the FastAPI backend go through here.
 * Set REACT_APP_API_BASE_URL for deployed environments.
 * If unset, requests use relative paths so CRA proxy can handle local dev.
 */

const BASE = (process.env.REACT_APP_API_BASE_URL || '').trim().replace(/\/+$/, '');

async function request(path, options = {}) {
  const url = BASE ? `${BASE}${path}` : path;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

/** POST /analyze  — main prediction endpoint */
export async function analyzeSong(features) {
  return request('/analyze', {
    method: 'POST',
    body: JSON.stringify(features),
  });
}

/** GET /algorithm-comparison */
export async function getAlgorithmComparison() {
  return request('/algorithm-comparison');
}

/** GET /cluster-overview */
export async function getClusterOverview() {
  return request('/cluster-overview');
}

/** GET /health */
export async function getHealth() {
  return request('/health');
}

/** GET /recommendations/:mood */
export async function getRecommendations(mood) {
  return request(`/recommendations/${encodeURIComponent(mood)}`);
}

/** GET /moods */
export async function getMoods() {
  return request('/moods');
}

/** GET /playlist?mood=...&limit=... */
export async function getPlaylist(mood, limit = 20) {
  return request(`/playlist?mood=${encodeURIComponent(mood)}&limit=${Math.max(1, Math.min(50, Number(limit) || 20))}`);
}

/** GET /youtube/search?q=...&limit=... */
export async function searchYouTubeVideos(query, limit = 8) {
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
  return request(`/youtube/search?q=${encodeURIComponent(query)}&limit=${safeLimit}`);
}

/** GET /youtube/track-info/:videoId */
export async function getYouTubeVideoInfo(videoId) {
  return request(`/youtube/track-info/${encodeURIComponent(videoId)}`);
}

/** POST /analyze-video/:videoId */
export async function analyzeYouTubeVideo(videoId) {
  return request(`/analyze-video/${encodeURIComponent(videoId)}`, {
    method: 'POST',
  });
}