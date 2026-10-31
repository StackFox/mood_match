import React, { useCallback, useEffect, useState } from 'react';
import { getMoods, getPlaylist } from '../api/api';
import CameraMoodDetector from '../components/CameraMoodDetector';
import './PlaylistPage.css';

/**
 * MoodMatch — the core flow from the project spec:
 * pick a mood (or detect it from your camera) → get a playlist of real
 * dataset songs sampled from the matching KMeans cluster.
 */
export default function PlaylistPage() {
  const [moods, setMoods] = useState([]);
  const [source, setSource] = useState(null);
  const [selected, setSelected] = useState(null);
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getMoods()
      .then((d) => { setMoods(d.moods || []); setSource(d.source); })
      .catch(() => setError('Backend unreachable — start the FastAPI server to load playlists.'));
  }, []);

  const loadPlaylist = useCallback(async (moodKey, origin = 'manual') => {
    setSelected(moodKey);
    setPlaylist(null);
    setError('');
    setLoading(true);
    try {
      const data = await getPlaylist(moodKey, 20);
      setPlaylist({ ...data, origin });
    } catch (e) {
      setError(e?.message || 'Could not load playlist.');
    } finally {
      setLoading(false);
    }
  }, []);

  function handleCameraMood(moodKey) {
    loadPlaylist(moodKey, 'camera');
  }

  return (
    <div className="playlist-page">
      <div className="playlist-intro card">
        <h2>🎧 MoodMatch</h2>
        <p>
          Pick a mood and get a playlist of real songs from the dataset — powered by the
          project's K-Means clustering (songs are grouped by audio features, then clusters
          are labeled by their average <em>valence</em> and <em>energy</em>).
        </p>
      </div>

      <div className="playlist-grid">
        {/* ── Left: mood selection ── */}
        <div className="playlist-left">
          <div className="card mood-picker-card">
            <div className="card-title">1️⃣ Pick your mood</div>
            <div className="mood-buttons">
              {moods.map((m) => (
                <button
                  key={m.key}
                  className={`mood-btn ${selected === m.key ? 'active' : ''}`}
                  onClick={() => loadPlaylist(m.key, 'manual')}
                  disabled={loading}
                >
                  <span className="mood-emoji">{m.emoji}</span>
                  <span className="mood-name">{m.name.split(' / ')[0]}</span>
                  <span className="mood-count">{m.song_count?.toLocaleString()} songs</span>
                </button>
              ))}
              {!moods.length && (
                <p className="mood-empty">Loading moods… (is the backend running?)</p>
              )}
            </div>
          </div>

          <CameraMoodDetector onMoodDetected={handleCameraMood} disabled={loading} />
        </div>

        {/* ── Right: playlist results ── */}
        <div className="playlist-right card">
          {error && <div className="playlist-error">{error}</div>}

          {!playlist && !loading && !error && (
            <div className="playlist-empty">
              <div className="playlist-empty-icon">🎵</div>
              <h3>No playlist yet</h3>
              <p>Choose a mood on the left — or let the camera detect how you feel.</p>
            </div>
          )}

          {loading && (
            <div className="playlist-loading">
              <div className="spinner" />
              <span>Sampling from the cluster…</span>
            </div>
          )}

          {playlist && !loading && (
            <div className="playlist-results">
              <div className="playlist-head">
                <div className="playlist-head-main">
                  <span className="playlist-head-emoji">{playlist.emoji}</span>
                  <div>
                    <h3>{playlist.mood_name}</h3>
                    <p>{playlist.description}</p>
                  </div>
                </div>
                <div className="playlist-head-meta">
                  {playlist.origin === 'camera' && <span className="origin-chip">📷 detected from camera</span>}
                  <span className="origin-chip">
                    cluster #{playlist.cluster_id} · {playlist.total_matches?.toLocaleString()} songs · {playlist.source === 'kmeans_clusters' ? 'K-Means' : 'quadrants'}
                  </span>
                </div>
              </div>

              <ol className="song-list">
                {playlist.songs.map((s, i) => (
                  <li className="song-row" key={`${s.track_name}-${i}`}>
                    <span className="song-index">{i + 1}</span>
                    <div className="song-meta">
                      <div className="song-title">{s.track_name}</div>
                      <div className="song-artist">{s.artists}</div>
                    </div>
                    <div className="song-chips">
                      <span className="chip" title="Energy">⚡ {Math.round(s.energy * 100)}</span>
                      <span className="chip" title="Valence">😊 {Math.round(s.valence * 100)}</span>
                      {s.danceability != null && (
                        <span className="chip" title="Danceability">💃 {Math.round(s.danceability * 100)}</span>
                      )}
                    </div>
                    <a
                      className="btn btn-ghost song-play"
                      href={s.youtube_search_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ▶ Play
                    </a>
                  </li>
                ))}
              </ol>

              <button className="btn btn-primary playlist-refresh" onClick={() => loadPlaylist(playlist.mood, playlist.origin)}>
                🔄 Shuffle another 20
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
