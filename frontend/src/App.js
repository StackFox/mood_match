import React, { useState, useEffect } from 'react';
import PlaylistPage from './pages/PlaylistPage';
import AnalyzePage from './pages/AnalyzePage';
import ComparePage from './pages/ComparePage';
import ExplorePage from './pages/ExplorePage';
import { getHealth } from './api/api';
import './App.css';

const PAGE_KEY = 'mma.page';
const VIEW_MODE_KEY = 'mma.viewMode';

export default function App() {
  const [page, setPage]           = useState(() => localStorage.getItem(PAGE_KEY) || 'playlist');
  const [viewMode, setViewMode]   = useState(() => localStorage.getItem(VIEW_MODE_KEY) || 'beginner');
  const [backendOk, setBackendOk] = useState(null);  // null=checking, true=ok, false=down
  const [demoMode, setDemoMode]   = useState(false);

  useEffect(() => {
    getHealth()
      .then(d => { setBackendOk(true); setDemoMode(d.demo_mode); })
      .catch(() => { setBackendOk(false); setDemoMode(true); });
  }, []);

  useEffect(() => {
    localStorage.setItem(PAGE_KEY, page);
  }, [page]);

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  return (
    <div className="app-shell">
      {/* ── Top nav ── */}
      <nav className="topnav">
        <div className="topnav-inner">
          <div className="brand">
            <span className="brand-icon">🎵</span>
            <span className="brand-name">Music Mood Analyzer</span>
            <span className="brand-sub">UML Clustering Project</span>
          </div>

          <div className="nav-links">
            {[
              { id: 'playlist', label: '😊 MoodMatch' },
              { id: 'analyze', label: '⚡ Analyze Song' },
              { id: 'compare', label: '📊 Compare Algorithms' },
              { id: 'explore', label: '🗺️ Explore Clusters' },
            ].map(n => (
              <button
                key={n.id}
                className={`nav-btn ${page === n.id ? 'active' : ''}`}
                onClick={() => setPage(n.id)}
              >
                {n.label}
              </button>
            ))}
          </div>

          <div className="status-pill">
            <div className="view-mode-toggle" role="tablist" aria-label="View mode">
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'beginner' ? 'active' : ''}`}
                onClick={() => setViewMode('beginner')}
              >
                Beginner View
              </button>
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'research' ? 'active' : ''}`}
                onClick={() => setViewMode('research')}
              >
                Research View
              </button>
            </div>
            <span className="status checking">Mode: {viewMode === 'research' ? 'Research' : 'Beginner'}</span>
            {backendOk === null && <span className="status checking">⏳ Connecting…</span>}
            {backendOk === true  && !demoMode && <span className="status live">🟢 Backend Live</span>}
            {backendOk === true  && demoMode  && <span className="status demo">🟡 Demo Mode</span>}
            {backendOk === false && <span className="status offline">🔴 Backend Offline</span>}
          </div>
        </div>
      </nav>

      {/* ── Demo banner ── */}
      {(backendOk === false || demoMode) && (
        <div className="demo-banner">
          ⚠️ Running in demo mode — backend not connected or model files missing.
          Start the FastAPI server to enable real ML predictions.
        </div>
      )}

      {/* ── Pages ── */}
      <main className="main-content">
        {page === 'playlist' && <PlaylistPage />}
        {page === 'analyze' && <AnalyzePage viewMode={viewMode} />}
        {page === 'compare' && <ComparePage viewMode={viewMode} />}
        {page === 'explore' && <ExplorePage />}
      </main>

      <footer className="footer">
        K-Means · HDBSCAN · GMM · DBSCAN · UMAP · YouTube Data API · FastAPI · React
      </footer>
    </div>
  );
}