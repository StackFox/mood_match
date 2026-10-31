import React, { useState, useEffect } from 'react';
import { getAlgorithmComparison } from '../api/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, Legend,
} from 'recharts';
import InteractiveUmapExplorer from '../components/InteractiveUmapExplorer';
import './ComparePage.css';

const COLORS = { 'K-Means': '#4A90D9', 'HDBSCAN': '#E07B54', 'GMM (spherical)': '#8B6BB1' };
const METRIC_HINTS = {
  silhouette: 'How clearly separated clusters are. Higher means cleaner separation.',
  db: 'How compact and separated clusters are. Lower is better.',
  ch: 'How well clusters separate relative to within-cluster spread. Higher is better.',
};

const UMAP_PLOTS = [
  {
    id: 'kmeans-final',
    title: 'K-Means UMAP Clusters',
    subtitle: 'Baseline segmentation with strong global structure.',
    src: '/plots/KMeans.png',
    highlights: [
      'k=4 selected (near-tie with k=3 silhouette)',
      'Augmented features clearly outperform raw features',
      'Best as the baseline map of broad mood zones',
    ],
    keyStats: [
      { label: 'Silhouette', value: '0.3437 @ k=4' },
      { label: 'vs Raw Features', value: '+59% silhouette' },
      { label: 'C-H Gain', value: '+157%' },
      { label: 'Largest Group', value: 'High Energy/Mainstream (62%)' },
    ],
    bullets: [
      'Feature engineering in Phase 3 materially improved separation quality.',
      'Melancholic/Acoustic appears as the cleanest and most distinct region.',
      'Energetic/Upbeat and High Energy/Mainstream are adjacent, so boundary songs are hard-label sensitive.',
    ],
    takeaway: 'Use K-Means as the strongest hard-cluster baseline and shape reference before density/probabilistic refinement.',
  },
  {
    id: 'hdbscan-final',
    title: 'HDBSCAN Final UMAP Clusters',
    subtitle: 'Density-based clustering with robust core discovery and noise labelling.',
    src: '/plots/phase4_hdbscan_final.png',
    highlights: [
      '4 stable dense clusters across a wide sweep',
      '57.4% labeled as boundary/noise songs',
      'Finds nuanced sub-structures K-Means merges',
    ],
    keyStats: [
      { label: 'Stable Setting Range', value: 'mcs 750-2000' },
      { label: 'Clusters', value: '4 dense cores' },
      { label: 'Noise / Boundary', value: '57.4%' },
      { label: 'Overlap Signal', value: '20,685 shared songs with K-Means mainstream cluster' },
    ],
    bullets: [
      'Noise is an uncertainty signal, not failure: ambiguous songs are left unforced.',
      'Isolates Cinematic/Electronic and Bittersweet/Acoustic that K-Means could not cleanly split.',
      'Cross-method agreement on Melancholic/Acoustic and High Energy/Mainstream supports real structure.',
    ],
    takeaway: 'Use HDBSCAN when boundary honesty matters more than assigning every single track.',
  },
  {
    id: 'gmm-final',
    title: 'GMM Final UMAP Clusters',
    subtitle: 'Probabilistic mixture modeling with soft assignment behavior.',
    src: '/plots/phase4_gmm_final.png',
    highlights: [
      'k=4 chosen despite non-informative AIC/BIC trend',
      'Isolates Live/Electronic as its own component via liveness',
      'High confidence can still coexist with low perceptual separation',
    ],
    keyStats: [
      { label: 'Selected k', value: '4 components' },
      { label: 'Silhouette Peak', value: '0.082' },
      { label: 'Confidence Pattern', value: '0.96-0.98 mean' },
      { label: 'Unique Split', value: 'Live/Electronic isolated' },
    ],
    bullets: [
      'AIC/BIC kept falling, so selection relied on practical consistency and interpretability.',
      'Soft assignments capture overlap and ambiguity better than strict hard labels.',
      'Confidence should be interpreted with silhouette together to avoid over-trusting boundaries.',
    ],
    takeaway: 'Use GMM for probabilistic mood assignment where overlap is expected and confidence ranking is useful.',
  },
];

export default function ComparePage({ viewMode = 'beginner' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTechnical, setShowTechnical] = useState(viewMode === 'research');

  useEffect(() => {
    getAlgorithmComparison()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => {
        setData(STATIC_DATA);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    setShowTechnical(viewMode === 'research');
  }, [viewMode]);

  if (loading) return <div className="loading-center"><div className="spinner" style={{width:36,height:36,borderWidth:3}}/></div>;
  if (!data)   return null;

  const silhouetteData = data.algorithms.map(a => ({ name: a.name, value: a.silhouette, color: COLORS[a.name] || '#888' }));
  const dbData         = data.algorithms.map(a => ({ name: a.name, value: a.davies_bouldin, color: COLORS[a.name] || '#888' }));
  const chData         = data.algorithms.map(a => ({ name: a.name, value: +(a.calinski_harabasz / 1000).toFixed(1), color: COLORS[a.name] || '#888' }));

  // Radar data — normalize each metric to 0–1, invert DB (lower=better → higher=better)
  const maxSil = Math.max(...data.algorithms.map(a => a.silhouette));
  const maxDB  = Math.max(...data.algorithms.map(a => a.davies_bouldin));
  const maxCH  = Math.max(...data.algorithms.map(a => a.calinski_harabasz));
  const radarData = [
    { metric: 'Silhouette',       ...Object.fromEntries(data.algorithms.map(a => [a.name, +(a.silhouette / maxSil).toFixed(3)])) },
    { metric: 'Davies-Bouldin',   ...Object.fromEntries(data.algorithms.map(a => [a.name, +(1 - a.davies_bouldin / maxDB).toFixed(3)])) },
    { metric: 'Calinski-Harabasz',...Object.fromEntries(data.algorithms.map(a => [a.name, +(a.calinski_harabasz / maxCH).toFixed(3)])) },
    { metric: 'No Noise%',        ...Object.fromEntries(data.algorithms.map(a => [a.name, +(1 - a.noise_pct / 100).toFixed(3)])) },
  ];
  const technicalHidden = viewMode === 'beginner' && !showTechnical;

  return (
    <div className="compare-page">
      <div className="compare-header">
        <h1 className="page-title"><span className="gradient-text">Algorithm Comparison</span></h1>
        <p className="page-sub">K-Means vs HDBSCAN vs GMM — which algorithm best captures music mood?</p>
        <p className="page-sub">Current mode: <strong>{viewMode === 'research' ? 'Research' : 'Beginner'}</strong></p>
      </div>

      {/* Winner callout */}
      <div className="winner-callout card">
        <div className="callout-emoji">🏆</div>
        <div className="callout-body">
          <div className="callout-title">Winner: {data.winner}</div>
          <div className="callout-reason">{data.winner_reason}</div>
        </div>
      </div>

      <div className="compare-hero card">
        <div className="compare-hero-label">Quick Read</div>
        <h3>{data.winner} leads this dataset</h3>
        <p>{data.winner_reason}</p>
        {technicalHidden && (
          <button className="btn btn-ghost" onClick={() => setShowTechnical(true)}>
            See detailed metrics
          </button>
        )}
      </div>

      {/* Summary table */}
      {!technicalHidden && <div className="card" style={{marginBottom: 24}}>
        <div className="card-title">📋 Metrics Summary Table</div>
        <div className="metrics-table-wrap">
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Algorithm</th>
                <th>Silhouette ↑ <span className="metric-help" title={METRIC_HINTS.silhouette}>i</span></th>
                <th>Davies-Bouldin ↓ <span className="metric-help" title={METRIC_HINTS.db}>i</span></th>
                <th>Calinski-Harabasz ↑ <span className="metric-help" title={METRIC_HINTS.ch}>i</span></th>
                <th>Noise %</th>
                <th>Best Metric</th>
              </tr>
            </thead>
            <tbody>
              {data.algorithms.map(a => (
                <tr key={a.name} className={a.is_winner ? 'winner-row' : ''}>
                  <td className="algo-cell">
                    <span style={{color: COLORS[a.name] || '#888', fontWeight: 700}}>{a.name}</span>
                    {a.is_winner && <span className="badge badge-winner" style={{marginLeft: 8}}>WINNER</span>}
                  </td>
                  <td className={a.silhouette === Math.max(...data.algorithms.map(x=>x.silhouette)) ? 'best-cell' : ''}>
                    {a.silhouette.toFixed(4)}{a.note ? '*' : ''}
                  </td>
                  <td className={a.davies_bouldin === Math.min(...data.algorithms.map(x=>x.davies_bouldin)) ? 'best-cell' : ''}>
                    {a.davies_bouldin.toFixed(4)}
                  </td>
                  <td className={a.calinski_harabasz === Math.max(...data.algorithms.map(x=>x.calinski_harabasz)) ? 'best-cell' : ''}>
                    {a.calinski_harabasz.toLocaleString()}
                  </td>
                  <td>{a.noise_pct > 0 ? `${a.noise_pct}%` : '—'}</td>
                  <td><span className="metric-best-label">{a.best_metric}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.algorithms.find(a=>a.note) && (
            <p className="table-note">* {data.algorithms.find(a=>a.note)?.note}</p>
          )}
        </div>
      </div>}

      {/* Charts row */}
      {!technicalHidden && <div className="charts-grid">
        <div className="card">
          <div className="card-title">Silhouette Score ↑ (higher = better) <span className="metric-help" title={METRIC_HINTS.silhouette}>i</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={silhouetteData} margin={{top:5,right:10,left:-20,bottom:5}}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{fill:'#94a3b8',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis domain={[0,0.5]} tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{background:'#141428',border:'1px solid #2d2d50',borderRadius:8,fontSize:12}} cursor={{fill:'rgba(255,255,255,0.03)'}}/>
              <Bar dataKey="value" name="Silhouette" radius={[5,5,0,0]} barSize={50}>
                {silhouetteData.map((d,i) => <Cell key={i} fill={d.color}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Davies-Bouldin ↓ (lower = better) <span className="metric-help" title={METRIC_HINTS.db}>i</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dbData} margin={{top:5,right:10,left:-20,bottom:5}}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{fill:'#94a3b8',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis domain={[0,1.6]} tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{background:'#141428',border:'1px solid #2d2d50',borderRadius:8,fontSize:12}} cursor={{fill:'rgba(255,255,255,0.03)'}}/>
              <Bar dataKey="value" name="Davies-Bouldin" radius={[5,5,0,0]} barSize={50}>
                {dbData.map((d,i) => <Cell key={i} fill={d.color}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Calinski-Harabász ↑ (higher = better, in thousands) <span className="metric-help" title={METRIC_HINTS.ch}>i</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chData} margin={{top:5,right:10,left:-20,bottom:5}}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{fill:'#94a3b8',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{background:'#141428',border:'1px solid #2d2d50',borderRadius:8,fontSize:12}} cursor={{fill:'rgba(255,255,255,0.03)'}}/>
              <Bar dataKey="value" name="C-H (×1000)" radius={[5,5,0,0]} barSize={50}>
                {chData.map((d,i) => <Cell key={i} fill={d.color}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>}

      {/* Radar chart */}
      {!technicalHidden && <div className="card" style={{marginTop: 24}}>
        <div className="card-title">🕸️ Overall Performance Radar (all metrics normalized 0–1, higher = better)</div>
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={radarData} margin={{top:10,right:30,left:30,bottom:10}}>
            <PolarGrid stroke="#1e1e3a"/>
            <PolarAngleAxis dataKey="metric" tick={{fill:'#94a3b8',fontSize:12}}/>
            {data.algorithms.map(a => (
              <Radar key={a.name} name={a.name} dataKey={a.name}
                stroke={COLORS[a.name] || '#888'} fill={COLORS[a.name] || '#888'}
                fillOpacity={0.12} strokeWidth={2}/>
            ))}
            <Legend wrapperStyle={{fontSize:12, color:'#94a3b8'}}/>
            <Tooltip contentStyle={{background:'#141428',border:'1px solid #2d2d50',borderRadius:8,fontSize:12}}/>
          </RadarChart>
        </ResponsiveContainer>
        <p className="chart-note">Davies-Bouldin is inverted (1 - normalized_value) so higher is always better on this chart.</p>
      </div>}

      <div className="card" style={{marginTop: 24, marginBottom: 16}}>
        <div className="card-title">🧭 Interactive UMAP Explorer</div>
        <p className="umap-section-note">Click a point to inspect its cluster profile and sample songs. Filter by algorithm and mood.</p>
        <InteractiveUmapExplorer />
      </div>

      {technicalHidden && (
        <div className="compare-beginner-grid">
          {UMAP_PLOTS.map((plot) => (
            <div className="card compare-beginner-card" key={`beginner-${plot.id}`}>
              <div className="card-title">{plot.title}</div>
              <p>{plot.takeaway}</p>
            </div>
          ))}
        </div>
      )}

      {!technicalHidden && <section className="umap-section">
        <div className="card umap-section-header">
          <div className="card-title">🗺️ UMAP Clustering Findings and Conclusions</div>
          <p className="umap-section-note">A streamlined visual summary of your notebook findings: quick signals, core evidence, and final takeaway per algorithm.</p>
        </div>

        <div className="umap-plot-grid">
          {UMAP_PLOTS.map((plot) => (
            <article className="card umap-plot-card" key={plot.id}>
              <div className="umap-plot-meta">
                <h3>{plot.title}</h3>
                <p>{plot.subtitle}</p>
              </div>
              <img
                className="umap-plot-image"
                src={plot.src}
                alt={plot.title}
                loading="lazy"
              />
              <div className="umap-insights">
                <div className="umap-insights-title">At A Glance</div>
                <div className="umap-highlight-row">
                  {plot.highlights.map((item) => (
                    <span className="umap-highlight-chip" key={`${plot.id}-${item}`}>{item}</span>
                  ))}
                </div>

                <div className="umap-stat-grid">
                  {plot.keyStats.map((stat) => (
                    <div className="umap-stat-item" key={`${plot.id}-${stat.label}`}>
                      <div className="umap-stat-label">{stat.label}</div>
                      <div className="umap-stat-value">{stat.value}</div>
                    </div>
                  ))}
                </div>

                <div className="umap-insights-title">Key Findings</div>
                <ul className="umap-bullet-list">
                  {plot.bullets.map((line, idx) => (
                    <li key={`${plot.id}-bullet-${idx}`}>{line}</li>
                  ))}
                </ul>

                <div className="umap-takeaway">
                  <span>Takeaway</span>
                  <p>{plot.takeaway}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>}

      {/* DBSCAN note */}
      {!technicalHidden && <div className="dbscan-note card">
        <div className="card-title">ℹ️ Why DBSCAN is not in the comparison</div>
        <p>{data.dbscan_note}</p>
      </div>}
    </div>
  );
}

const STATIC_DATA = {
  algorithms: [
    { name:'K-Means', params:'k=4', silhouette:0.3426, davies_bouldin:1.0252, calinski_harabasz:79060, is_winner:false, color:'#4A90D9', best_metric:'Calinski-Harabasz', note:null, n_clusters:4, noise_pct:0 },
    { name:'HDBSCAN', params:'mcs=750', silhouette:0.3937, davies_bouldin:1.0058, calinski_harabasz:57801, is_winner:false, color:'#E07B54', best_metric:'Silhouette (with asterisk)', note:'Silhouette on 44.4% non-noise only', n_clusters:4, noise_pct:55.6 },
    { name:'GMM (spherical)', params:'k=4, spherical', silhouette:0.3867, davies_bouldin:0.8878, calinski_harabasz:76641, is_winner:true, color:'#8B6BB1', best_metric:'Davies-Bouldin', note:null, n_clusters:4, noise_pct:0 },
  ],
  winner: 'GMM (spherical)',
  winner_reason: 'Best Davies-Bouldin (0.8878) — most neutral metric. No asterisks. Only algorithm with soft probability assignments.',
  dbscan_note: 'DBSCAN was attempted but failed due to Spotify\'s feature discretisation (27% near-duplicate rows). Documented as a data characteristic finding.',
};