import React from 'react';
import './ConsensusInsightsCard.css';

const ORDER = ['kmeans', 'hdbscan', 'gmm'];

export default function ConsensusInsightsCard({ result }) {
  if (!result?.algorithms) return null;

  const rows = ORDER.map((id) => {
    const alg = result.algorithms[id];
    return {
      id,
      name: alg.name,
      mood: alg.cluster_name,
      color: alg.color,
      emoji: alg.emoji,
      confidence: Math.round((alg.confidence || 0) * 100),
    };
  });

  const moodCounts = rows.reduce((acc, row) => {
    acc[row.mood] = (acc[row.mood] || 0) + 1;
    return acc;
  }, {});
  const [topMood, topCount] = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0] || ['Unknown', 0];
  const avgConfidence = Math.round(rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length);

  let verdict = 'Low agreement';
  if (topCount === 3) verdict = 'Full agreement';
  else if (topCount === 2) verdict = 'Partial agreement';

  return (
    <div className="consensus-card card">
      <div className="card-title">🧭 Agreement & Confidence</div>
      <div className="consensus-grid">
        <div className="consensus-main">
          <div className="consensus-verdict">{verdict}</div>
          <div className="consensus-details">
            <span>Most selected mood:</span>
            <strong>{topMood}</strong>
            <span>({topCount}/3 algorithms)</span>
          </div>
          <div className="consensus-avg">Average confidence: <strong>{avgConfidence}%</strong></div>
        </div>

        <div className="consensus-list">
          {rows.map((row) => (
            <div className="consensus-row" key={row.id}>
              <div className="consensus-algo">{row.name}</div>
              <div className="consensus-mood" style={{ color: row.color }}>{row.emoji} {row.mood}</div>
              <div className="consensus-conf">{row.confidence}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}