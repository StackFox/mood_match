import React, { useState } from 'react';
import './AnalyzeHistoryPanel.css';

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
  } catch (e) {
    return 'recent';
  }
}

export default function AnalyzeHistoryPanel({ items, onLoad, onRemove, onClear }) {
  const [playingId, setPlayingId] = useState(null);

  function resolveTrackMeta(item) {
    const videoId = item.youtubeVideoId || item.youtube_video_id || item.result?.youtube_video_id || null;
    const youtubeUrl = item.youtubeUrl || item.result?.youtube_url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
    const embedUrl = item.embedUrl || item.result?.embed_url || (videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null);
    // Legacy items saved before the YouTube migration
    const legacyUrl = item.spotifyUrl || item.result?.spotify_url || null;
    return { videoId, youtubeUrl: youtubeUrl || legacyUrl, embedUrl };
  }

  return (
    <div className="history-panel card">
      <div className="history-head">
        <div className="card-title">🕘 Recent Analyses</div>
        {items.length > 0 && (
          <button className="btn btn-ghost history-clear" onClick={onClear}>Clear</button>
        )}
      </div>

      {items.length === 0 && (
        <p className="history-empty">Your recent runs appear here. Click one to restore instantly.</p>
      )}

      <div className="history-list">
        {items.map((item) => {
          const meta = resolveTrackMeta(item);
          const canPlay = Boolean(meta.videoId || meta.youtubeUrl);

          return <div className="history-item" key={item.id}>
            <button className="history-load" onClick={() => onLoad(item)}>
              <div className="history-title">
                {item.winnerEmoji || '🎵'} {item.songName || 'Unknown Song'}
              </div>
              <div className="history-meta">
                <span>{item.artistName || 'Unknown Artist'}</span>
                <span>{item.confidence}%</span>
                <span>{formatTime(item.createdAt)}</span>
              </div>
              <div className="history-mood" style={{ color: item.winnerColor || '#a78bfa' }}>{item.winnerMood}</div>
            </button>

            <div className="history-side-actions">
              {canPlay && (
                <button
                  className="history-play"
                  onClick={() => setPlayingId((prev) => (prev === item.id ? null : item.id))}
                >
                  {playingId === item.id ? 'Hide Player' : 'Play'}
                </button>
              )}
              <button className="history-delete" onClick={() => onRemove(item.id)} aria-label="Delete history item">×</button>
            </div>

            {playingId === item.id && (
              <div className="history-player">
                {meta.embedUrl ? (
                  <iframe
                    className="history-embed"
                    src={meta.embedUrl}
                    title={`YouTube player for ${item.songName || 'track'}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    loading="lazy"
                  />
                ) : null}

                {meta.youtubeUrl && (
                  <a className="btn btn-ghost history-open-link" href={meta.youtubeUrl} target="_blank" rel="noreferrer">
                    Open in YouTube
                  </a>
                )}
              </div>
            )}
          </div>;
        })}
      </div>
    </div>
  );
}