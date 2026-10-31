import React, { useEffect, useRef, useState } from 'react';
import { searchYouTubeVideos } from '../api/api';
import './FeatureInputPanel.css';

const PRESETS = {
  'Happy Pop':    { energy:0.78, valence:0.88, danceability:0.82, acousticness:0.05, liveness:0.10, speechiness:0.04, instrumentalness:0.01, tempo:128 },
  'Sad Acoustic': { energy:0.22, valence:0.18, danceability:0.30, acousticness:0.85, liveness:0.09, speechiness:0.03, instrumentalness:0.05, tempo:72  },
  'Metal':        { energy:0.92, valence:0.25, danceability:0.40, acousticness:0.02, liveness:0.20, speechiness:0.06, instrumentalness:0.08, tempo:160 },
  'Chill Indie':  { energy:0.35, valence:0.58, danceability:0.55, acousticness:0.50, liveness:0.08, speechiness:0.03, instrumentalness:0.30, tempo:88  },
  'EDM Club':     { energy:0.89, valence:0.72, danceability:0.91, acousticness:0.01, liveness:0.30, speechiness:0.05, instrumentalness:0.04, tempo:128 },
  'Jazz Piano':   { energy:0.28, valence:0.45, danceability:0.42, acousticness:0.90, liveness:0.12, speechiness:0.04, instrumentalness:0.80, tempo:96  },
};

const SLIDERS = [
  { key: 'energy',           label: 'Energy',           min: 0,   max: 1,   step: 0.01, hint: '0=calm, 1=intense' },
  { key: 'valence',          label: 'Valence',          min: 0,   max: 1,   step: 0.01, hint: '0=sad, 1=happy' },
  { key: 'danceability',     label: 'Danceability',     min: 0,   max: 1,   step: 0.01, hint: 'rhythmic ease' },
  { key: 'acousticness',     label: 'Acousticness',     min: 0,   max: 1,   step: 0.01, hint: '1=fully acoustic' },
  { key: 'liveness',         label: 'Liveness',         min: 0,   max: 1,   step: 0.01, hint: 'live audience presence' },
  { key: 'speechiness',      label: 'Speechiness',      min: 0,   max: 1,   step: 0.01, hint: '>0.66 = spoken word' },
  { key: 'instrumentalness', label: 'Instrumentalness', min: 0,   max: 1,   step: 0.01, hint: '>0.5 = no vocals' },
  { key: 'tempo',            label: 'Tempo',            min: 40,  max: 220, step: 1,    hint: 'BPM', unit: 'BPM' },
];

const DEFAULT_FEATURES = {
  energy: 0.65, valence: 0.55, danceability: 0.60, acousticness: 0.20,
  liveness: 0.15, speechiness: 0.05, instrumentalness: 0.05, tempo: 120,
};

const POPULAR_QUERIES = [
  'Blinding Lights',
  'Shape of You',
  'As It Was',
  'Levitating',
  'Someone Like You',
];

export default function FeatureInputPanel({ onAnalyze, onAnalyzeTrack, loading, onTrackSelect, onJourneyStepChange }) {
  const [features,    setFeatures]    = useState(DEFAULT_FEATURES);
  const [songName,    setSongName]    = useState('');
  const [artistName,  setArtistName]  = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedTrack, setSelectedTrack] = useState(null);
  const searchSeqRef = useRef(0);

  function applyPreset(name) {
    setFeatures(PRESETS[name]);
    setSongName(name);
    setArtistName('');
  }

  function updateFeature(key, val) {
    setFeatures(f => ({ ...f, [key]: val }));
  }

  function handleSubmit() {
    onAnalyze({ ...features, song_name: songName || 'Unknown Song', artist_name: artistName });
  }

  useEffect(() => {
    const q = searchQuery.trim();
    if (onJourneyStepChange) onJourneyStepChange('search', q.length >= 2);
    const currentSeq = searchSeqRef.current + 1;
    searchSeqRef.current = currentSeq;

    if (q.length < 2) {
      setSearchResults([]);
      setSearchError('');
      setSearchLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      try {
        const data = await searchYouTubeVideos(q, 5);
        if (searchSeqRef.current !== currentSeq) return;
        const items = (data.items || []).slice(0, 5);
        setSearchResults(items);
        if (!items.length) {
          setSearchError('No songs found. Try artist + track title.');
        }
      } catch (e) {
        if (searchSeqRef.current !== currentSeq) return;
        setSearchResults([]);
        setSearchError(e?.message || 'YouTube search is unavailable right now. Use manual fallback below.');
      } finally {
        if (searchSeqRef.current === currentSeq) {
          setSearchLoading(false);
        }
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (onTrackSelect) onTrackSelect(selectedTrack);
    if (onJourneyStepChange) {
      onJourneyStepChange('select', Boolean(selectedTrack));
      onJourneyStepChange('preview', Boolean(selectedTrack && selectedTrack.id));
    }
  }, [selectedTrack, onTrackSelect, onJourneyStepChange]);

  function resetForm() {
    setFeatures(DEFAULT_FEATURES);
    setSongName('');
    setArtistName('');
    setSelectedTrack(null);
  }

  function getVideoUrl(track) {
    return track?.youtube_url || (track?.id ? `https://www.youtube.com/watch?v=${track.id}` : '');
  }

  return (
    <div className="feature-panel card">
      <div className="card-title">🎸 Song Features</div>

      <div className="spotify-section">
        <div className="spotify-title">Search YouTube (recommended)</div>
        <div className="spotify-search-row">
          <input
            type="text"
            placeholder="Search song or artist (e.g. Blinding Lights The Weeknd)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="spotify-popular-row">
          <span>Try popular songs:</span>
          {POPULAR_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              className="spotify-popular-chip"
              onClick={() => setSearchQuery(q)}
            >
              {q}
            </button>
          ))}
        </div>
        {searchLoading && (
          <div className="spotify-skeleton-list" aria-hidden="true">
            {[1, 2, 3].map((n) => <div className="spotify-skeleton-item" key={n} />)}
          </div>
        )}
        {searchError && <div className="spotify-error">{searchError}</div>}

        {selectedTrack && (
          <div className="spotify-preview-card spotify-now-playing">
            <div className="spotify-preview-title">Now Playing & Analyze</div>
            <div className="spotify-preview-name">{selectedTrack.name}</div>
            <div className="spotify-preview-sub">{selectedTrack.artists}</div>

            {selectedTrack.id && (
              <iframe
                className="spotify-embed-player"
                src={`https://www.youtube-nocookie.com/embed/${selectedTrack.id}`}
                title={`YouTube player for ${selectedTrack.name}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                loading="lazy"
              />
            )}
            {getVideoUrl(selectedTrack) && (
              <a
                className="btn btn-ghost spotify-open-link"
                href={getVideoUrl(selectedTrack)}
                target="_blank"
                rel="noreferrer"
              >
                Open in YouTube
              </a>
            )}

            <button
              className="btn btn-primary spotify-run-btn"
              onClick={() => {
                if (onJourneyStepChange) onJourneyStepChange('analyze', true);
                onAnalyzeTrack(selectedTrack);
              }}
              disabled={loading}
            >
              {loading ? <><div className="spinner"/>&nbsp; Analyzing...</> : 'Analyze Selected Song'}
            </button>
          </div>
        )}

        {!searchLoading && searchResults.length > 0 && (
          <div className="spotify-results">
            {searchResults.map((track) => (
              <div
                className={`spotify-item ${selectedTrack?.id === track.id ? 'selected' : ''}`}
                key={track.id}
                onClick={() => setSelectedTrack(track)}
              >
                <div className="spotify-item-meta">
                  <div className="spotify-item-name">{track.name}</div>
                  <div className="spotify-item-sub">{track.artists}</div>
                </div>
                <button
                  className="btn btn-ghost spotify-analyze-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTrack(track);
                    if (onAnalyzeTrack) {
                      if (onJourneyStepChange) onJourneyStepChange('analyze', true);
                      onAnalyzeTrack(track);
                    }
                  }}
                  disabled={loading}
                >
                  Select & Analyze
                </button>
              </div>
            ))}
          </div>
        )}


      </div>

      <details className="manual-fallback">
        <summary>Manual feature input (fallback)</summary>

        {/* Song info */}
        <div className="song-info">
          <div className="field">
            <label>Song name</label>
            <input type="text" placeholder="e.g. Blinding Lights" value={songName}
              onChange={e => setSongName(e.target.value)}/>
          </div>
          <div className="field">
            <label>Artist</label>
            <input type="text" placeholder="e.g. The Weeknd" value={artistName}
              onChange={e => setArtistName(e.target.value)}/>
          </div>
        </div>

        {/* Presets */}
        <div className="presets-section">
          <div className="presets-label">Quick presets</div>
          <div className="presets-grid">
            {Object.keys(PRESETS).map(name => (
              <button key={name} className="preset-btn" onClick={() => applyPreset(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div className="sliders-section">
          {SLIDERS.map(s => {
            const val = features[s.key];
            const pct = ((val - s.min) / (s.max - s.min) * 100).toFixed(1) + '%';
            return (
              <div className="slider-row" key={s.key}>
                <div className="slider-label-row">
                  <span className="slider-name">{s.label} <span className="slider-hint">({s.hint})</span></span>
                  <span className="slider-val">{s.unit ? `${Math.round(val)} ${s.unit}` : val.toFixed(2)}</span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step} value={val}
                  style={{ '--pct': pct }}
                  onChange={e => updateFeature(s.key, parseFloat(e.target.value))}
                />
              </div>
            );
          })}
        </div>

        <button className="btn btn-primary manual-analyze-btn" disabled={loading} onClick={handleSubmit}>
          {loading ? <><div className="spinner"/>&nbsp; Analyzing…</> : '⚡  Analyze Manual Input'}
        </button>
        <button className="btn btn-ghost reset-btn" disabled={loading} onClick={resetForm}>
          Reset Inputs
        </button>
      </details>
    </div>
  );
}