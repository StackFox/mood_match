import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import './MetricsComparisonChart.css';

const COLORS = { kmeans: '#4A90D9', hdbscan: '#E07B54', gmm: '#8B6BB1' };
const NAMES  = { kmeans: 'K-Means', hdbscan: 'HDBSCAN', gmm: 'GMM' };
const METRIC_HINTS = {
  silhouette: 'How clearly separated clusters are. Higher means cleaner separation.',
  db: 'How compact and separated clusters are. Lower is better.',
  ch: 'How well clusters separate relative to within-cluster spread. Higher is better.',
};

export default function MetricsComparisonChart({ algorithms }) {
  const algoList = ['kmeans', 'hdbscan', 'gmm'];

  const silData = algoList.map(id => ({
    name: NAMES[id],
    value: algorithms[id].metrics.silhouette,
    color: COLORS[id],
    isWinner: algorithms[id].metrics.silhouette_rank === 1,
  }));

  const dbData = algoList.map(id => ({
    name: NAMES[id],
    value: algorithms[id].metrics.davies_bouldin,
    color: COLORS[id],
    isWinner: algorithms[id].metrics.db_rank === 1,
  }));

  const chData = algoList.map(id => ({
    name: NAMES[id],
    value: +(algorithms[id].metrics.calinski_harabasz / 1000).toFixed(1),
    color: COLORS[id],
    isWinner: algorithms[id].metrics.ch_rank === 1,
  }));

  return (
    <div className="metrics-chart-wrap card">
      <div className="card-title">📈 Metric-by-Metric Comparison</div>
      <p className="metrics-intro">
        Each metric rewards different properties. No single algorithm wins all three — that's the honest finding.
      </p>

      <div className="metrics-grid">
        {/* Silhouette */}
        <div className="metric-block">
          <div className="metric-block-title">Silhouette Score <span className="better">(higher = better)</span><span className="metric-help" title={METRIC_HINTS.silhouette}>i</span></div>
          <div className="metric-block-note">Measures how well-separated clusters are. HDBSCAN wins — but computed on only 44.4% of songs (noise excluded).</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={silData} margin={{ top: 10, right: 10, left: -24, bottom: 0 }} barSize={44}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis domain={[0, 0.5]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: '#141428', border: '1px solid #2d2d50', borderRadius: 6, fontSize: 11 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }}/>
              <Bar dataKey="value" name="Silhouette" radius={[5, 5, 0, 0]}>
                {silData.map((d, i) => <Cell key={i} fill={d.color} opacity={d.isWinner ? 1 : 0.55}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Davies-Bouldin */}
        <div className="metric-block">
          <div className="metric-block-title">Davies-Bouldin <span className="better">(lower = better)</span><span className="metric-help" title={METRIC_HINTS.db}>i</span></div>
          <div className="metric-block-note">Most neutral metric. Compactness vs separation. GMM wins cleanly — no asterisks. This is why GMM is the project winner.</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dbData} margin={{ top: 10, right: 10, left: -24, bottom: 0 }} barSize={44}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis domain={[0, 1.6]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: '#141428', border: '1px solid #2d2d50', borderRadius: 6, fontSize: 11 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }}/>
              <Bar dataKey="value" name="Davies-Bouldin" radius={[5, 5, 0, 0]}>
                {dbData.map((d, i) => <Cell key={i} fill={d.color} opacity={d.isWinner ? 1 : 0.55}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Calinski-Harabász */}
        <div className="metric-block">
          <div className="metric-block-title">Calinski-Harabász ×1000 <span className="better">(higher = better)</span><span className="metric-help" title={METRIC_HINTS.ch}>i</span></div>
          <div className="metric-block-note">K-Means wins — but it's partly circular. K-Means literally optimises the ratio CH measures, so its win here is expected.</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chData} margin={{ top: 10, right: 10, left: -24, bottom: 0 }} barSize={44}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e1e3a" vertical={false}/>
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: '#141428', border: '1px solid #2d2d50', borderRadius: 6, fontSize: 11 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }}/>
              <Bar dataKey="value" name="CH (×1000)" radius={[5, 5, 0, 0]}>
                {chData.map((d, i) => <Cell key={i} fill={d.color} opacity={d.isWinner ? 1 : 0.55}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="verdict-box">
        <span className="verdict-icon">🏆</span>
        <div>
          <strong>Verdict:</strong> GMM wins Davies-Bouldin (0.8878) fairly. HDBSCAN's silhouette win has an asterisk (only 44.4% of data). K-Means' CH win is partly circular (it optimises what CH measures). GMM is the most honest winner.
        </div>
      </div>
    </div>
  );
}