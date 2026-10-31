import React, { useEffect, useState } from 'react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import './ExplorePage.css';

const ALGO_TABS = [
  { id: 'kmeans',  label: 'K-Means',  color: '#4A90D9' },
  { id: 'hdbscan', label: 'HDBSCAN',  color: '#E07B54' },
  { id: 'gmm',     label: 'GMM ★',    color: '#8B6BB1' },
];

// Ground truth from the trained models on the 80,206-song clustered dataset:
// per-label counts and mean feature profiles (kept in sync with backend
// CLUSTER_PROFILES — see backend/render_plots.py + _build_cluster_profiles).
const CLUSTER_DATA = {
  kmeans: [
    { id: 2, name: 'Energetic / Upbeat',       color: '#4A90D9', emoji: '⚡', size: 9788,  sizePct: '12.2%',
      description: 'High mood_ev, by far the highest liveness (0.491). Wide genre range unified by intensity and energy. Includes rock, drum & bass, live recordings.',
      profile: { mood_ev: 0.625, mood_dark: 0.050, mood_groove: 0.301, acousticness_log: 0.231, liveness_log: 0.491 },
      examples: ['SiM', 'Yngwie Malmsteen', 'Drum and Bass artists', 'Live rock recordings'] },
    { id: 0, name: 'Melancholic / Acoustic',   color: '#8B6BB1', emoji: '🌧️', size: 7152,  sizePct: '8.9%',
      description: 'Dominant mood_dark (0.674), highest acousticness (0.646), lowest energy. Most coherent and distinct cluster. Piano, folk, classical.',
      profile: { mood_ev: 0.163, mood_dark: 0.674, mood_groove: 0.098, acousticness_log: 0.646, liveness_log: 0.135 },
      examples: ['Yiruma', 'Brad Mehldau', 'Sara Watkins', 'Classical piano'] },
    { id: 1, name: 'High Energy / Mainstream', color: '#E07B54', emoji: '🔥', size: 49551, sizePct: '61.8%',
      description: 'Largest cluster — 62% of the dataset. High mood_ev and groove, low acousticness. Mainstream produced music across all sub-genres.',
      profile: { mood_ev: 0.641, mood_dark: 0.021, mood_groove: 0.336, acousticness_log: 0.132, liveness_log: 0.146 },
      examples: ['Pop', 'Hip-hop', 'Electronic', 'Mainstream across all genres'] },
    { id: 3, name: 'Indie / Mid-Tempo',        color: '#3D7A5E', emoji: '🌿', size: 13715, sizePct: '17.1%',
      description: 'Most balanced feature profile. Elevated acousticness and mood_dark but not extreme. Emotionally complex middle ground.',
      profile: { mood_ev: 0.384, mood_dark: 0.268, mood_groove: 0.268, acousticness_log: 0.498, liveness_log: 0.140 },
      examples: ['Kate Bush', 'Stephen Sanchez', 'Ysabelle Cuevas', 'Indie singer-songwriter'] },
  ],
  hdbscan: [
    { id: 1, name: 'Cinematic / Electronic',   color: '#4A90D9', emoji: '🎬', size: 7213,  sizePct: '9.0%',
      description: 'High mood_ev, near-zero groove, very low acousticness. K-Means absorbed this into Energetic/Upbeat — HDBSCAN found the denser sub-region.',
      profile: { mood_ev: 0.563, mood_dark: 0.010, mood_groove: 0.000, acousticness_log: 0.027, liveness_log: 0.150 },
      examples: ['Hans Zimmer', 'Leftfield', 'Mandragora', 'Instrumental electronic'] },
    { id: 0, name: 'Melancholic / Acoustic',   color: '#8B6BB1', emoji: '🌧️', size: 3699,  sizePct: '4.6%',
      description: 'Highest mood_dark (0.681), highest acousticness (0.658), zero groove. Piano, folk, classical. Independently matches K-Means cluster 0.',
      profile: { mood_ev: 0.169, mood_dark: 0.681, mood_groove: 0.000, acousticness_log: 0.658, liveness_log: 0.100 },
      examples: ['Yiruma', 'Brad Mehldau', 'Classical piano', 'Folk'] },
    { id: 2, name: 'Bittersweet / Acoustic',   color: '#3D7A5E', emoji: '🍂', size: 2134,  sizePct: '2.7%',
      description: 'Mid mood_dark, high acousticness, some groove. Sad but with movement. K-Means missed this nuance entirely.',
      profile: { mood_ev: 0.341, mood_dark: 0.384, mood_groove: 0.307, acousticness_log: 0.573, liveness_log: 0.102 },
      examples: ['Bollywood acoustic', 'Folk with rhythm', 'Singer-songwriter'] },
    { id: 3, name: 'High Energy / Mainstream', color: '#E07B54', emoji: '🔥', size: 21117, sizePct: '26.3%',
      description: 'Highest mood_ev (0.657) and groove (0.378). Directly matches the K-Means mainstream cluster. Confirmed by both algorithms.',
      profile: { mood_ev: 0.657, mood_dark: 0.007, mood_groove: 0.378, acousticness_log: 0.041, liveness_log: 0.147 },
      examples: ['Mainstream pop', 'Hip-hop', 'Electronic dance'] },
  ],
  gmm: [
    { id: 2, name: 'Live / Electronic',         color: '#4A90D9', emoji: '🎧', size: 8229,  sizePct: '10.3%',
      description: 'Defining feature is liveness (0.523 vs 0.13–0.15 for all others). K-Means absorbed these. GMM isolated them due to spherical Gaussians being sensitive to liveness outliers.',
      profile: { mood_ev: 0.615, mood_dark: 0.062, mood_groove: 0.298, acousticness_log: 0.256, liveness_log: 0.523 },
      examples: ['RŮDE', 'Blaqk Audio', 'Tritonal', 'Live electronic', 'Club recordings'] },
    { id: 3, name: 'Introspective / Indie',     color: '#3D7A5E', emoji: '🌿', size: 10991, sizePct: '13.7%',
      description: 'Elevated mood_dark and acousticness, mid mood_ev. Emotionally complex acoustic tracks. Not purely sad nor energetic.',
      profile: { mood_ev: 0.358, mood_dark: 0.311, mood_groove: 0.257, acousticness_log: 0.529, liveness_log: 0.136 },
      examples: ['Holly Humberstone', 'Don McLean', 'Andreas Vollenweider', 'Indie folk'] },
    { id: 0, name: 'High Energy / Mainstream',  color: '#E07B54', emoji: '🔥', size: 54379, sizePct: '67.8%',
      description: 'Largest component at 68% of the dataset. Confirmed by every algorithm. BTS, Julian Cope, Amon Tobin. The catch-all for mainstream produced music.',
      profile: { mood_ev: 0.631, mood_dark: 0.028, mood_groove: 0.333, acousticness_log: 0.148, liveness_log: 0.152 },
      examples: ['BTS', 'Julian Cope', 'Amon Tobin', 'All mainstream genres'] },
    { id: 1, name: 'Melancholic / Acoustic',    color: '#8B6BB1', emoji: '🌧️', size: 6607,  sizePct: '8.2%',
      description: 'Fourth algorithm to independently find this group. Lowest mood_ev (0.155), highest mood_dark (0.689). Same group K-Means cluster 0 finds.',
      profile: { mood_ev: 0.155, mood_dark: 0.689, mood_groove: 0.091, acousticness_log: 0.649, liveness_log: 0.134 },
      examples: ['Norah Jones', 'Jefferson Airplane', 'Moby', 'Ambient folk'] },
  ],
};

function ClusterCard({ cluster }) {
  const radarData = Object.entries(cluster.profile).map(([k, v]) => ({
    feature: k.replace('_log','').replace('_capped','').replace('mood_',''),
    value: +v.toFixed(3),
  }));

  return (
    <div className="cluster-card card">
      <div className="cluster-header" style={{ borderLeftColor: cluster.color }}>
        <div className="cluster-emoji">{cluster.emoji}</div>
        <div>
          <div className="cluster-name" style={{ color: cluster.color }}>{cluster.name}</div>
          <div className="cluster-size">n ≈ {cluster.size.toLocaleString()} songs ({cluster.sizePct})</div>
        </div>
      </div>
      <p className="cluster-desc">{cluster.description}</p>

      <div className="cluster-radar">
        <ResponsiveContainer width="100%" height={160}>
          <RadarChart data={radarData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
            <PolarGrid stroke="#1e1e3a"/>
            <PolarAngleAxis dataKey="feature" tick={{ fill: '#64748b', fontSize: 9 }}/>
            <Radar dataKey="value" stroke={cluster.color} fill={cluster.color} fillOpacity={0.2} strokeWidth={1.5}/>
            <Tooltip contentStyle={{ background: '#141428', border: '1px solid #2d2d50', borderRadius: 6, fontSize: 11 }}/>
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="cluster-examples">
        <div className="examples-label">Examples</div>
        <div className="examples-list">
          {cluster.examples.map((e, i) => (
            <span key={i} className="example-chip" style={{ borderColor: cluster.color + '44', color: cluster.color }}>{e}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const [activeAlgo, setActiveAlgo] = useState(() => {
    const stored = localStorage.getItem('mma.explore.algo');
    return ['kmeans', 'hdbscan', 'gmm'].includes(stored) ? stored : 'gmm';
  });

  useEffect(() => {
    localStorage.setItem('mma.explore.algo', activeAlgo);
  }, [activeAlgo]);

  const clusters = CLUSTER_DATA[activeAlgo];

  return (
    <div className="explore-page">
      <div className="explore-header">
        <h1 className="page-title"><span className="gradient-text">Explore Mood Clusters</span></h1>
        <p className="page-sub">What mood groups did each algorithm discover in the 80,206-song clustered dataset?</p>
      </div>

      <div className="algo-selector">
        {ALGO_TABS.map(t => (
          <button key={t.id} className={`algo-tab ${activeAlgo === t.id ? 'active' : ''}`}
            style={activeAlgo === t.id ? { borderColor: t.color, color: t.color, background: t.color + '18' } : {}}
            onClick={() => setActiveAlgo(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="explore-note card">
        {activeAlgo === 'kmeans'  && <p><strong>K-Means (k=4):</strong> Forces every song into exactly 4 clusters. Augmented features (composite mood scores) gave silhouette 0.343 — 59% better than raw features. Cluster 1 (High Energy / Mainstream) is very large at 62%, suggesting soft boundaries between high-energy moods.</p>}
        {activeAlgo === 'hdbscan' && <p><strong>HDBSCAN (mcs=750):</strong> Only clusters dense regions. 57.4% of songs were labelled as noise (boundary songs). Found Bittersweet/Acoustic as a genuine sub-structure K-Means missed. Strong stability across mcs=750–2000 confirms these 4 dense cores are real.</p>}
        {activeAlgo === 'gmm'     && <p><strong>GMM — Project Winner (spherical, k=4):</strong> Only algorithm with soft probability assignments. Best Davies-Bouldin (0.8878) — the most neutral metric. Isolated Live/Electronic as a distinct group based on liveness. Confirmed Melancholic/Acoustic for the fourth time independently.</p>}
      </div>

      <div className="clusters-grid">
        {clusters.map(c => <ClusterCard key={c.id} cluster={c} />)}
      </div>

      <div className="cross-algo-card card">
        <div className="card-title">🔁 Cross-Algorithm Agreement</div>
        <p className="cross-intro">Two mood groups were found <strong>independently</strong> by all three working algorithms — the strongest evidence of real structure.</p>
        <div className="agreement-grid">
          <div className="agreement-item" style={{ borderColor: '#8B6BB1' }}>
            <div className="agreement-emoji">🌧️</div>
            <div className="agreement-name" style={{ color: '#8B6BB1' }}>Melancholic / Acoustic</div>
            <div className="agreement-detail">K-Means cluster 0 (7,152) · HDBSCAN cluster 0 (3,699) · GMM cluster 1 (6,607)</div>
            <div className="agreement-verdict">Piano, folk, classical. Low energy, low valence, high acousticness. Unmistakable across all approaches.</div>
          </div>
          <div className="agreement-item" style={{ borderColor: '#E07B54' }}>
            <div className="agreement-emoji">🔥</div>
            <div className="agreement-name" style={{ color: '#E07B54' }}>High Energy / Mainstream</div>
            <div className="agreement-detail">K-Means cluster 1 (49,551) · HDBSCAN cluster 3 (21,117) · GMM cluster 0 (54,379)</div>
            <div className="agreement-verdict">Mainstream produced pop, hip-hop, electronic. High mood_ev and groove, low acousticness. The dominant group in Spotify's catalog.</div>
          </div>
        </div>
      </div>
    </div>
  );
}