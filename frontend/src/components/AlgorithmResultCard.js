import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import './AlgorithmResultCard.css';

export default function AlgorithmResultCard({ data }) {
  const [tab, setTab] = useState('profile');  // 'profile' | 'all' | 'probs'

  const profileData = Object.entries(data.cluster_profile).map(([k, v]) => ({
    name: k.replace('_log', '').replace('_capped', '').replace('mood_', ''),
    value: +parseFloat(v).toFixed(3),
  }));

  // All clusters profile comparison
  const allProfileData = data.all_cluster_profiles
    ? Object.entries(data.all_cluster_profiles).map(([id, prof]) => ({
        name: data.cluster_names?.[id] ?? `Cluster ${id}`,
        ...Object.fromEntries(Object.entries(prof).map(([k, v]) => [
          k.replace('_log', '').replace('_capped', '').replace('mood_', ''),
          +parseFloat(v).toFixed(3)
        ])),
        isAssigned: parseInt(id) === data.label,
      }))
    : [];

  const confPct = Math.round((data.confidence || 0) * 100);

  return (
    <div className={`algo-card card ${data.is_winner ? 'winner' : ''}`}>
      {data.is_winner && <div className="winner-badge-strip">🏆 WINNER</div>}

      {/* Header */}
      <div className="algo-header">
        <div className="algo-title-row">
          <span className="algo-name">{data.name}</span>
          {data.is_noise && <span className="badge badge-noise">noise</span>}
        </div>
        <div className="algo-subtitle">{data.subtitle}</div>
      </div>

      {/* Assigned cluster */}
      <div className="algo-summary-grid">
        <div className="assigned-cluster" style={{ borderLeftColor: data.color }}>
          <span className="assigned-emoji">{data.emoji}</span>
          <div>
            <div className="assigned-name" style={{ color: data.color }}>{data.cluster_name}</div>
            <div className="assigned-desc">{data.cluster_description}</div>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="conf-section">
          <div className="conf-label-row">
            <span className="conf-label">Confidence</span>
            <span className="conf-pct" style={{ color: data.color }}>{confPct}%</span>
          </div>
          <div className="conf-bar-bg">
            <div className="conf-bar-fill" style={{ width: `${confPct}%`, background: data.color }}/>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="card-tabs">
        <button className={`card-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Cluster Profile</button>
        <button className={`card-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All Clusters</button>
        {data.probabilities && (
          <button className={`card-tab ${tab === 'probs' ? 'active' : ''}`} onClick={() => setTab('probs')}>Probabilities</button>
        )}
      </div>

      {/* Profile chart */}
      {tab === 'profile' && (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={profileData} margin={{ top: 5, right: 5, left: -30, bottom: 0 }} barSize={16}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis domain={[0, 1]} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: '#141428', border: '1px solid #2d2d50', borderRadius: 6, fontSize: 11 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }}/>
              <Bar dataKey="value" fill={data.color} radius={[3, 3, 0, 0]} opacity={0.85}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* All clusters comparison */}
      {tab === 'all' && allProfileData.length > 0 && (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={allProfileData} margin={{ top: 5, right: 5, left: -30, bottom: 20 }} barSize={10}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end"/>
              <YAxis domain={[0, 1]} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: '#141428', border: '1px solid #2d2d50', borderRadius: 6, fontSize: 10 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }}/>
              {['ev', 'dark', 'groove', 'acousticness', 'liveness'].map((f, i) => (
                <Bar key={f} dataKey={f} name={f} fill={['#4A90D9','#8B6BB1','#E07B54','#3D7A5E','#F5C842'][i]} radius={[2,2,0,0]} opacity={0.75}/>
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div style={{fontSize:'0.68rem',color:'#475569',textAlign:'center',marginTop:4}}>
            ← Showing all {allProfileData.length} clusters. Your song → <strong style={{color:data.color}}>{data.cluster_name}</strong>
          </div>
        </div>
      )}

      {/* GMM probabilities */}
      {tab === 'probs' && data.probabilities && (
        <div className="probs-wrap">
          {data.probabilities.map((p, i) => (
            <div className="prob-row" key={i}>
              <span className="prob-name">{p.emoji} {p.cluster_name}</span>
              <div className="prob-bar-bg">
                <div className="prob-bar-fill" style={{ width: `${Math.round(p.probability * 100)}%`, background: p.color }}/>
              </div>
              <span className="prob-pct" style={{ color: p.color }}>{Math.round(p.probability * 100)}%</span>
            </div>
          ))}
          <p className="probs-note">GMM is the only algorithm with soft probabilities — musically honest, as songs rarely sit perfectly in one mood.</p>
        </div>
      )}

      {/* Metrics footer */}
      <div className="metrics-footer">
        {[
          { label: 'Silhouette ↑', val: data.metrics.silhouette.toFixed(4), rank: data.metrics.silhouette_rank },
          { label: 'DB ↓',         val: data.metrics.davies_bouldin.toFixed(4), rank: data.metrics.db_rank },
          { label: 'CH ↑',         val: (data.metrics.calinski_harabasz / 1000).toFixed(1) + 'k', rank: data.metrics.ch_rank },
        ].map(m => (
          <div className={`metric-chip ${m.rank === 1 ? 'best' : ''}`} key={m.label}>
            <div className="metric-chip-label">{m.label}</div>
            <div className="metric-chip-val">{m.val} {m.rank === 1 ? '✓' : ''}</div>
          </div>
        ))}
      </div>
      {data.metrics.note && (
        <div className="metrics-note">* {data.metrics.note}</div>
      )}
    </div>
  );
}