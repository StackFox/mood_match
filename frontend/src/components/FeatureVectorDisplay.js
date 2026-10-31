import React from 'react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import './FeatureVectorDisplay.css';

const FEATURE_EXPLANATIONS = {
  mood_ev:            'Energy-Valence Index. (energy + valence) / 2. High = euphoric/upbeat, Low = sad/depressing.',
  mood_groove:        'Groove Score. danceability × tempo_norm × has_vocals. Rhythmic intent — not just fast, but danceable AND vocal.',
  mood_dark:          'Darkness Score. (1 - valence) × acousticness_log × (1 - energy). Multiplicative — all three must be true.',
  acousticness_log:   'log1p(acousticness). Compressed spike near 0. High = acoustic (guitar, piano), Low = electric/produced.',
  liveness_log:       'log1p(liveness). High = recorded with live audience. Low = studio recording.',
  speechiness_capped: 'speechiness clipped at 0.33. Above 0.33 = speech/music hybrid, not pure music.',
};

export default function FeatureVectorDisplay({ vector, raw }) {
  const radarData = Object.entries(vector).map(([k, v]) => ({
    feature: k.replace('_log', '').replace('_capped', '').replace('mood_', ''),
    value: +parseFloat(v).toFixed(3),
  }));

  return (
    <div className="fv-wrap card">
      <div className="card-title">🔧 Engineered Feature Vector</div>
      <p className="fv-intro">
        These 6 features are what's actually fed into the clustering algorithms — the result of Phase 3 feature engineering.
        Raw track features (energy, valence, etc.) were transformed into these composite scores.
      </p>

      <div className="fv-grid">
        {/* Feature chips */}
        <div className="fv-chips">
          {Object.entries(vector).map(([key, val]) => (
            <div className="fv-chip" key={key}>
              <div className="fv-chip-name">{key.replace('_log','').replace('_capped','').replace('mood_','')}</div>
              <div className="fv-chip-val">{parseFloat(val).toFixed(3)}</div>
              <div className="fv-chip-bar-bg">
                <div className="fv-chip-bar-fill" style={{ width: `${Math.min(parseFloat(val) * 100, 100)}%` }}/>
              </div>
              <div className="fv-chip-explain">{FEATURE_EXPLANATIONS[key]}</div>
            </div>
          ))}
        </div>

        {/* Radar */}
        <div className="fv-radar">
          <div className="fv-radar-title">Song Feature Radar</div>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
              <PolarGrid stroke="#1e1e3a"/>
              <PolarAngleAxis dataKey="feature" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
              <Radar dataKey="value" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.2} strokeWidth={2}/>
              <Tooltip contentStyle={{ background: '#141428', border: '1px solid #2d2d50', borderRadius: 6, fontSize: 11 }}/>
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Raw features */}
      <div className="raw-section">
        <div className="raw-title">Raw Input Features (before engineering)</div>
        <div className="raw-chips">
          {['energy', 'valence', 'danceability', 'acousticness', 'liveness', 'speechiness', 'instrumentalness'].map(key => (
            <div className="raw-chip" key={key}>
              <span className="raw-key">{key}</span>
              <span className="raw-val">{(raw[key] ?? '–').toFixed ? parseFloat(raw[key]).toFixed(2) : raw[key]}</span>
            </div>
          ))}
          {raw.tempo && (
            <div className="raw-chip">
              <span className="raw-key">tempo</span>
              <span className="raw-val">{Math.round(raw.tempo)} BPM</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
