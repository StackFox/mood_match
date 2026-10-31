function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token) {
  const base = token.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base + '='.repeat((4 - (base.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildSnapshotToken(payload) {
  return toBase64Url(JSON.stringify(payload));
}

export function parseSnapshotToken(token) {
  try {
    return JSON.parse(fromBase64Url(token));
  } catch (e) {
    return null;
  }
}

export function buildSnapshotUrl(payload) {
  const url = new URL(window.location.href);
  url.searchParams.set('snap', buildSnapshotToken(payload));
  return url.toString();
}

export function downloadSnapshot(payload, filename = 'analysis-snapshot.json') {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}