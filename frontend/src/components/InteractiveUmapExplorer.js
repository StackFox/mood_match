import React, { useEffect, useMemo, useState } from 'react';
import { getClusterOverview, getRecommendations } from '../api/api';
import './InteractiveUmapExplorer.css';

function toPoint(cluster, algorithm) {
  const p = cluster.profile || {};
  const acoustic = Math.min(Math.max(Number(p.acousticness_log || 0), 0), 1);
  const moodEv = Math.min(Math.max(Number(p.mood_ev || 0), 0), 1);
  const moodDark = Math.min(Math.max(Number(p.mood_dark || 0), 0), 1);
  const groove = Math.min(Math.max(Number(p.mood_groove || 0), 0), 1);

  const x = Math.max(5, Math.min(95, ((moodEv - moodDark + 1) / 2) * 100));
  const y = Math.max(5, Math.min(95, ((groove + (1 - acoustic)) / 2) * 100));

  return {
    id: `${algorithm}-${cluster.id}`,
    clusterId: cluster.id,
    algorithm,
    name: cluster.name,
    color: cluster.color,
    emoji: cluster.emoji,
    description: cluster.description,
    x,
    y,
    profile: p,
  };
}

export default function InteractiveUmapExplorer() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [algorithm, setAlgorithm] = useState('kmeans');
  const [moodFilter, setMoodFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [recCache, setRecCache] = useState({});

  useEffect(() => {
    getClusterOverview()
      .then((data) => {
        setOverview(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e?.message || 'Unable to load cluster overview.');
        setLoading(false);
      });
  }, []);

  const points = useMemo(() => {
    if (!overview?.[algorithm]) return [];
    return overview[algorithm].map((c) => toPoint(c, algorithm));
  }, [overview, algorithm]);

  const visiblePoints = useMemo(() => {
    if (moodFilter === 'all') return points;
    return points.filter((p) => p.name === moodFilter);
  }, [points, moodFilter]);

  useEffect(() => {
    if (!selected?.name || recCache[selected.name]) return;
    getRecommendations(selected.name)
      .then((data) => {
        setRecCache((prev) => ({ ...prev, [selected.name]: data.recommendations || [] }));
      })
      .catch(() => {
        setRecCache((prev) => ({ ...prev, [selected.name]: [] }));
      });
  }, [selected, recCache]);

  if (loading) {
    return <div className="umap-explorer-loading">Loading interactive map...</div>;
  }

  if (error) {
    return <div className="umap-explorer-error">{error}</div>;
  }

  const selectedRecs = selected ? (recCache[selected.name] || []).slice(0, 3) : [];

  return (
    <div className="umap-explorer">
      <div className="umap-controls">
        <label>
          Algorithm
          <select value={algorithm} onChange={(e) => { setAlgorithm(e.target.value); setSelected(null); }}>
            <option value="kmeans">K-Means</option>
            <option value="hdbscan">HDBSCAN</option>
            <option value="gmm">GMM</option>
          </select>
        </label>

        <label>
          Mood Filter
          <select value={moodFilter} onChange={(e) => { setMoodFilter(e.target.value); setSelected(null); }}>
            <option value="all">All moods</option>
            {points.map((p) => (
              <option key={`mood-${p.id}`} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="umap-map-area">
        {visiblePoints.map((p) => (
          <button
            type="button"
            key={p.id}
            className={`umap-point ${selected?.id === p.id ? 'active' : ''}`}
            style={{ left: `${p.x}%`, bottom: `${p.y}%`, background: p.color }}
            onClick={() => setSelected(p)}
            title={`${p.name}`}
          >
            {p.emoji}
          </button>
        ))}
        <div className="umap-axis x">Mood EV / Brightness</div>
        <div className="umap-axis y">Groove + Low Acousticness</div>
      </div>

      {selected && (
        <div className="umap-tooltip-card">
          <h4>{selected.emoji} {selected.name}</h4>
          <p>{selected.description}</p>
          <div className="umap-mini-stats">
            <span>mood_ev: {Number(selected.profile.mood_ev || 0).toFixed(3)}</span>
            <span>mood_dark: {Number(selected.profile.mood_dark || 0).toFixed(3)}</span>
            <span>mood_groove: {Number(selected.profile.mood_groove || 0).toFixed(3)}</span>
          </div>
          {selectedRecs.length > 0 && (
            <div className="umap-sample-songs">
              <strong>Sample songs</strong>
              {selectedRecs.map((r) => <div key={`${selected.id}-${r.track}`}>{r.track} - {r.artist}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}