import React from 'react';
import './RecommendationsPanel.css';

export default function RecommendationsPanel({ recommendations, mood, color }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="recs-wrap card">
      <div className="card-title">🎧 Recommended Songs</div>
      <p className="recs-intro">
        Songs from the <strong style={{ color }}>{mood}</strong> cluster — matched by feature similarity to your song.
      </p>

      <div className="recs-list">
        {recommendations.map((rec, i) => (
          <div className="rec-item" key={i}>
            <div className="rec-num" style={{ background: color + '22', color }}>
              {i + 1}
            </div>
            <div className="rec-info">
              <div className="rec-track">{rec.track}</div>
              <div className="rec-artist">{rec.artist}</div>
            </div>
            <div className="rec-bars">
              <MiniBar label="NRG" value={rec.energy} color={color}/>
              <MiniBar label="VAL" value={rec.valence} color={color}/>
              {rec.tempo && <div className="rec-tempo">{Math.round(rec.tempo)}<span>BPM</span></div>}
            </div>
          </div>
        ))}
      </div>

      <div className="recs-legend">
        <span>NRG = Energy</span>
        <span>VAL = Valence (positiveness)</span>
        <span>BPM = Beats per minute</span>
      </div>
    </div>
  );
}

function MiniBar({ label, value, color }) {
  return (
    <div className="mini-bar-group">
      <div className="mini-bar-label">{label}</div>
      <div className="mini-bar-bg">
        <div className="mini-bar-fill" style={{ width: `${Math.round(value * 100)}%`, background: color }}/>
      </div>
      <div className="mini-bar-val">{value.toFixed(2)}</div>
    </div>
  );
}
