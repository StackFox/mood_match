import React, { useEffect, useMemo, useState } from 'react';
import './CompareTwoSongsPanel.css';

function confidencePct(item) {
  const fromResult = item?.result?.algorithms?.gmm?.confidence;
  if (typeof fromResult === 'number') return Math.round(fromResult * 100);
  return Number(item?.confidence) || 0;
}

function overlapRecommendations(itemA, itemB) {
  const listA = itemA?.result?.recommendations || [];
  const listB = itemB?.result?.recommendations || [];
  const key = (r) => `${String(r.track || '').toLowerCase()}|${String(r.artist || '').toLowerCase()}`;
  const bSet = new Set(listB.map(key));
  return listA.filter((r) => bSet.has(key(r))).slice(0, 4);
}

export default function CompareTwoSongsPanel({ items }) {
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  useEffect(() => {
    if (!items.length) return;
    if (!leftId) setLeftId(items[0].id);
    if (!rightId) {
      const second = items.find((x) => x.id !== items[0].id);
      if (second) setRightId(second.id);
    }
  }, [items, leftId, rightId]);

  const left = useMemo(() => items.find((x) => x.id === leftId) || null, [items, leftId]);
  const right = useMemo(() => items.find((x) => x.id === rightId) || null, [items, rightId]);

  if (items.length < 2) {
    return (
      <div className="compare-songs card">
        <div className="card-title">🎧 Compare Two Songs Mode</div>
        <p className="compare-songs-note">Analyze at least two songs to unlock side-by-side comparison.</p>
      </div>
    );
  }

  const leftConfidence = confidencePct(left);
  const rightConfidence = confidencePct(right);
  const confDelta = leftConfidence - rightConfidence;
  const overlap = overlapRecommendations(left, right);

  return (
    <div className="compare-songs card">
      <div className="card-title">🎧 Compare Two Songs Mode</div>

      <div className="compare-select-grid">
        <label>
          Song A
          <select value={leftId} onChange={(e) => setLeftId(e.target.value)}>
            {items.map((item) => (
              <option key={`a-${item.id}`} value={item.id}>{item.songName} - {item.artistName || 'Unknown Artist'}</option>
            ))}
          </select>
        </label>

        <label>
          Song B
          <select value={rightId} onChange={(e) => setRightId(e.target.value)}>
            {items.map((item) => (
              <option key={`b-${item.id}`} value={item.id}>{item.songName} - {item.artistName || 'Unknown Artist'}</option>
            ))}
          </select>
        </label>
      </div>

      {left && right && (
        <>
          <div className="compare-panels">
            <div className="compare-song-card">
              <h4>{left.songName}</h4>
              <p>{left.artistName || 'Unknown Artist'}</p>
              <div className="compare-pill">Mood: {left.winnerMood || 'Unknown'}</div>
              <div className="compare-pill">Confidence: {leftConfidence}%</div>
            </div>

            <div className="compare-song-card">
              <h4>{right.songName}</h4>
              <p>{right.artistName || 'Unknown Artist'}</p>
              <div className="compare-pill">Mood: {right.winnerMood || 'Unknown'}</div>
              <div className="compare-pill">Confidence: {rightConfidence}%</div>
            </div>
          </div>

          <div className="compare-delta-grid">
            <div className="delta-card">
              <span>Mood Delta</span>
              <strong>{left.winnerMood === right.winnerMood ? 'Same mood bucket' : `${left.winnerMood} vs ${right.winnerMood}`}</strong>
            </div>
            <div className="delta-card">
              <span>Confidence Delta</span>
              <strong>{confDelta > 0 ? '+' : ''}{confDelta}% (A - B)</strong>
            </div>
            <div className="delta-card">
              <span>Recommendation Overlap</span>
              <strong>{overlap.length} shared tracks</strong>
            </div>
          </div>

          {overlap.length > 0 && (
            <div className="overlap-list">
              {overlap.map((r) => (
                <span key={`${r.track}-${r.artist}`}>{r.track} - {r.artist}</span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}