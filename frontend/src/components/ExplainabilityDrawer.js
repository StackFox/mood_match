import React, { useMemo, useState } from 'react';
import './ExplainabilityDrawer.css';

function buildFeatureChips(vector = {}) {
  const chips = [];
  if (vector.mood_dark >= 0.45) chips.push('High mood_dark');
  if (vector.acousticness_log >= 0.5) chips.push('Strong acoustic signal');
  if (vector.mood_ev >= 0.6) chips.push('High mood_ev');
  if (vector.mood_groove >= 0.32) chips.push('Groove-forward rhythm');
  if (vector.speechiness_capped >= 0.2) chips.push('Speech-heavy vocal style');
  if (chips.length === 0) chips.push('Balanced feature profile');
  return chips;
}

export default function ExplainabilityDrawer({ result }) {
  const [open, setOpen] = useState(false);

  const chips = useMemo(() => buildFeatureChips(result?.feature_vector || {}), [result]);
  const algorithmLines = useMemo(() => {
    if (!result?.algorithms) return [];
    return ['kmeans', 'hdbscan', 'gmm']
      .filter((id) => result.algorithms[id])
      .map((id) => {
        const alg = result.algorithms[id];
        const confidence = Math.round((alg.confidence || 0) * 100);
        return `${alg.name}: assigns ${alg.cluster_name} (${confidence}% confidence) based on current feature profile alignment.`;
      });
  }, [result]);

  if (!result) return null;

  return (
    <div className={`explain-drawer card ${open ? 'open' : ''}`}>
      <div className="explain-head">
        <div className="card-title">🧠 Why this mood?</div>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide explanation' : 'Open explanation'}
        </button>
      </div>

      {open && (
        <div className="explain-body">
          <div className="explain-chip-row">
            {chips.map((chip) => <span key={chip}>{chip}</span>)}
          </div>

          <div className="explain-lines">
            {algorithmLines.map((line, idx) => <p key={`line-${idx}`}>{line}</p>)}
          </div>

          <div className="explain-final">
            <strong>Final winner reason:</strong> {result.winner_reason}
          </div>
        </div>
      )}
    </div>
  );
}