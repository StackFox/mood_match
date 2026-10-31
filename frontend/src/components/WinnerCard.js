import React from 'react';
import './WinnerCard.css';

export default function WinnerCard({ result }) {
  return (
    <div className="winner-card" style={{ borderColor: result.winner_color, background: result.winner_color + '10' }}>
      <div className="winner-left">
        <div className="winner-emoji">{result.winner_emoji}</div>
        <div>
          <div className="winner-label">🏆 {result.winner_label} — Winner</div>
          <div className="winner-mood" style={{ color: result.winner_color }}>{result.winner_mood}</div>
          {result.song_name && result.song_name !== 'Unknown Song' && (
            <div className="winner-song">
              🎵 {result.song_name}{result.artist_name ? ` — ${result.artist_name}` : ''}
            </div>
          )}
          <div className="winner-description">{result.winner_description}</div>
        </div>
      </div>
      <div className="winner-right">
        <div className="winner-reason-label">Why GMM wins</div>
        <div className="winner-reason">{result.winner_reason}</div>
        {result.demo_mode && <span className="badge badge-demo" style={{marginTop: 8, display:'inline-block'}}>Demo Mode</span>}
      </div>
    </div>
  );
}
