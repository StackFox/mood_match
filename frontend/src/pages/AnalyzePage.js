import React, { useEffect, useMemo, useState } from 'react';
import { analyzeSong, analyzeYouTubeVideo } from '../api/api';
import FeatureInputPanel from '../components/FeatureInputPanel';
import WinnerCard from '../components/WinnerCard';
import AlgorithmResultCard from '../components/AlgorithmResultCard';
import MetricsComparisonChart from '../components/MetricsComparisonChart';
import RecommendationsPanel from '../components/RecommendationsPanel';
import FeatureVectorDisplay from '../components/FeatureVectorDisplay';
import AnalyzeHistoryPanel from '../components/AnalyzeHistoryPanel';
import ConsensusInsightsCard from '../components/ConsensusInsightsCard';
import ExplainabilityDrawer from '../components/ExplainabilityDrawer';
import { buildSnapshotUrl, downloadSnapshot, parseSnapshotToken } from '../utils/analyzeSnapshot';
import './AnalyzePage.css';

const DEMO_FALLBACK = {
  energy: 0.78, valence: 0.88, danceability: 0.82, acousticness: 0.05,
  liveness: 0.10, speechiness: 0.04, instrumentalness: 0.01, tempo: 128,
  song_name: 'Happy Pop', artist_name: '',
};

const HISTORY_KEY = 'mma.analyze.history';
const HISTORY_LIMIT = 10;
const JOURNEY_STEPS = ['search', 'select', 'preview', 'analyze', 'result'];

export default function AnalyzePage({ viewMode = 'beginner' }) {
  const tabOptions = useMemo(() => (['algorithms', 'metrics', 'features', 'recommendations']), []);
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [notice,  setNotice]  = useState('');
  const [noticeKind, setNoticeKind] = useState('info'); // 'ok' | 'warn' | 'demo' | 'info'
  const [history, setHistory] = useState(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });
  const [copiedLabel, setCopiedLabel] = useState('');
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [journeyState, setJourneyState] = useState({ search: false, select: false, preview: false, analyze: false, result: false });
  const [showTechnical, setShowTechnical] = useState(viewMode === 'research');
  const [activeTab, setTab]   = useState(() => {
    const stored = localStorage.getItem('mma.analyze.tab');
    return ['algorithms', 'metrics', 'features', 'recommendations'].includes(stored) ? stored : 'algorithms';
  });

  useEffect(() => {
    localStorage.setItem('mma.analyze.tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    setShowTechnical(viewMode === 'research');
  }, [viewMode]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('snap');
    if (!token) return;
    const snapshot = parseSnapshotToken(token);
    if (!snapshot?.result) return;

    setResult(snapshot.result);
    setNotice('Loaded a shared analysis snapshot from URL.');
    setError('');
  }, []);

  async function handleAnalyze(features) {
    setLoading(true);
    setError('');
    setNotice('');
    setResult(null);
    try {
      const data = await analyzeSong(features);
      setResult(data);
      pushToHistory(features, data);
      setJourneyState((prev) => ({ ...prev, analyze: true, result: true }));
      setTab(tabOptions.includes(activeTab) ? activeTab : 'algorithms');
      if (data.demo_mode) {
        setNotice('Running with demo predictions because backend model files are missing.');
      }
    } catch (e) {
      // If backend is down, generate a demo result locally
      const fallback = buildDemoResult(features);
      setResult(fallback);
      pushToHistory(features, fallback);
      setJourneyState((prev) => ({ ...prev, analyze: true, result: true }));
      setError(e?.message || 'Backend unavailable.');
      setNotice('Backend is unreachable. Showing local demo predictions so you can keep testing UI flows.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyzeTrack(trackInput) {
    const trackId = typeof trackInput === 'string' ? trackInput : trackInput?.id;
    const trackMeta = typeof trackInput === 'object' && trackInput ? trackInput : null;
    if (!trackId) {
      setError('No video selected.');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    setNoticeKind('info');
    setResult(null);
    try {
      const data = await analyzeYouTubeVideo(trackId);
      setResult(data);
      pushToHistory({ song_name: data.song_name, artist_name: data.artist_name }, data, trackMeta);
      setJourneyState((prev) => ({ ...prev, analyze: true, result: true }));
      setTab(tabOptions.includes(activeTab) ? activeTab : 'algorithms');
      if (data.feature_source === 'dataset_match') {
        setNotice(data.feature_note || 'Matched to the project dataset — using its real audio features.');
        setNoticeKind('ok');
      } else if (data.feature_source === 'youtube_metadata_heuristic') {
        setNotice(data.feature_note || 'Analyzed using YouTube metadata estimates.');
        setNoticeKind('warn');
      } else if (data.demo_mode) {
        setNotice('Video metadata loaded, but predictions are currently in demo mode.');
        setNoticeKind('demo');
      } else {
        setNotice('YouTube video analyzed successfully.');
      }
    } catch (e) {
      setError(e?.message || 'Video analysis unavailable.');
      setNotice('Could not analyze this video. Use manual fallback input below.');
      setNoticeKind('demo');
    } finally {
      setLoading(false);
    }
  }

  function pushToHistory(input, output, trackMeta = null) {
    const youtubeVideoId = output.youtube_video_id || trackMeta?.id || null;
    const youtubeUrl = output.youtube_url || trackMeta?.youtube_url || (youtubeVideoId ? `https://www.youtube.com/watch?v=${youtubeVideoId}` : null);
    const embedUrl = output.embed_url || (youtubeVideoId ? `https://www.youtube-nocookie.com/embed/${youtubeVideoId}` : null);

    const next = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      songName: output.song_name || input.song_name || 'Unknown Song',
      artistName: output.artist_name || input.artist_name || '',
      winnerMood: output.winner_mood,
      winnerColor: output.winner_color,
      winnerEmoji: output.winner_emoji,
      confidence: Math.round(((output.algorithms?.gmm?.confidence || 0) * 100)),
      youtubeVideoId,
      youtubeUrl,
      embedUrl,
      result: output,
    };

    setHistory((prev) => [next, ...prev].slice(0, HISTORY_LIMIT));
  }

  function restoreFromHistory(item) {
    setResult(item.result);
    setError('');
    setJourneyState((prev) => ({ ...prev, result: true }));
    setNotice(`Loaded saved run from ${new Date(item.createdAt).toLocaleString()}.`);
  }

  function removeHistoryItem(id) {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }

  function clearHistory() {
    setHistory([]);
  }

  async function copyJson() {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopiedLabel('JSON copied');
    window.setTimeout(() => setCopiedLabel(''), 1300);
  }

  async function copyShareLink() {
    if (!result) return;
    const payload = { version: 1, createdAt: new Date().toISOString(), result };
    const url = buildSnapshotUrl(payload);
    await navigator.clipboard.writeText(url);
    setCopiedLabel('Share link copied');
    window.setTimeout(() => setCopiedLabel(''), 1300);
  }

  function downloadJsonSnapshot() {
    if (!result) return;
    const safeName = (result.song_name || 'analysis').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadSnapshot({ version: 1, createdAt: new Date().toISOString(), result }, `${safeName}-snapshot.json`);
  }

  function clearResults() {
    setResult(null);
    setError('');
    setNotice('');
    setJourneyState((prev) => ({ ...prev, result: false, analyze: false }));
  }

  function handleJourneyStepChange(step, done) {
    if (!JOURNEY_STEPS.includes(step)) return;
    setJourneyState((prev) => ({ ...prev, [step]: Boolean(done) }));
  }

  const confidencePct = result ? Math.round((result.algorithms?.gmm?.confidence || 0) * 100) : 0;
  const showStickyNowPlaying = Boolean(selectedTrack);
  const technicalHidden = viewMode === 'beginner' && !showTechnical;

  return (
    <div className="analyze-page">
      <div className="analyze-header">
        <h1 className="page-title">
          <span className="gradient-text">Analyze a Song's Mood</span>
        </h1>
        <p className="page-sub">
          Enter YouTube video features → run all 3 clustering algorithms → compare results → find the best mood label
        </p>
      </div>

      {(notice || error) && (
        <div className={`analysis-message card analysis-message--${error ? 'error' : noticeKind}`}>
          {notice && (
            <p>
              {noticeKind === 'ok' && <span className="analysis-message-badge">✓ In dataset</span>}
              {noticeKind === 'warn' && <span className="analysis-message-badge">⚠ Estimated — not verified in dataset</span>}
              {noticeKind === 'demo' && <span className="analysis-message-badge">⚠ Demo</span>}
              {notice}
            </p>
          )}
          {error && <p className="analysis-error">Details: {error}</p>}
        </div>
      )}

      <div className="journey-stepper card">
        {[
          { id: 'search', label: 'Search Song' },
          { id: 'select', label: 'Select' },
          { id: 'preview', label: 'Preview' },
          { id: 'analyze', label: 'Analyze' },
          { id: 'result', label: 'Result' },
        ].map((step, idx) => {
          const active = journeyState[step.id];
          return (
            <div className={`journey-step ${active ? 'active' : ''}`} key={step.id}>
              <span>{idx + 1}</span>
              <p>{step.label}</p>
            </div>
          );
        })}
      </div>

      {showStickyNowPlaying && (
        <div className="sticky-now-playing card">
          <div className="sticky-meta">
            <div className="sticky-label">Now Playing</div>
            <div className="sticky-title">{selectedTrack.name}</div>
            <div className="sticky-sub">{selectedTrack.artists}</div>
          </div>
          <div className="sticky-controls">
            {selectedTrack.id ? (
              <a className="btn btn-ghost" href={selectedTrack.youtube_url || `https://www.youtube.com/watch?v=${selectedTrack.id}`} target="_blank" rel="noreferrer">
                Watch on YouTube
              </a>
            ) : null}
            <button className="btn btn-primary sticky-analyze-btn" disabled={loading} onClick={() => handleAnalyzeTrack(selectedTrack)}>
              {loading ? 'Analyzing...' : 'Analyze This Song'}
            </button>
          </div>
        </div>
      )}

      <div className="analyze-grid">
        {/* ── Left: Input ── */}
        <div className="left-col">
          <div className="left-stack">
            <FeatureInputPanel
              onAnalyze={handleAnalyze}
              onAnalyzeTrack={handleAnalyzeTrack}
              onTrackSelect={setSelectedTrack}
              onJourneyStepChange={handleJourneyStepChange}
              loading={loading}
            />
            <AnalyzeHistoryPanel
              items={history}
              onLoad={restoreFromHistory}
              onRemove={removeHistoryItem}
              onClear={clearHistory}
            />
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div className="right-col">
          {!result && !loading && (
            <div className="empty-state card">
              <div className="empty-icon">🎵</div>
              <h3>No analysis yet</h3>
              <p>Start with YouTube search in the left panel, then select a song and run analysis.</p>
              <div className="empty-examples">
                <span className="empty-chip">Try: Blinding Lights</span>
                <span className="empty-chip">Try: Heat Waves</span>
                <span className="empty-chip">Try: Skyfall</span>
              </div>
              <p>Or use <strong>Try popular songs</strong> suggestions in search.</p>
              <ul>
                <li>All 3 algorithms will run on your song</li>
                <li>You'll see which cluster each assigns</li>
                <li>GMM is highlighted as the project winner</li>
                <li>Recommendations appear based on the winning mood</li>
              </ul>
            </div>
          )}

          {loading && (
            <div className="loading-state card">
              <p>Preparing your result cards...</p>
              <div className="skeleton-stack">
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
              </div>
            </div>
          )}

          {result && (
            <>

              <div className="result-hero card">
                <div>
                  <div className="result-hero-label">Result Summary</div>
                  <h3>{result.winner_emoji} {result.winner_mood}</h3>
                  {result.feature_source === 'youtube_metadata_heuristic' && (
                    <p className="feature-source-caveat">
                      ⚠ Estimated from YouTube metadata — this song wasn't found (or couldn't be
                      verified) in the dataset, so treat this mood as approximate.
                    </p>
                  )}
                  <p>{result.winner_reason}</p>
                  {result.confidence_note && (
                    <p className="confidence-caveat">{result.confidence_note}</p>
                  )}
                </div>
                <div className="result-hero-metrics">
                  <div><span>Confidence</span><strong>{confidencePct}%</strong></div>
                  <div><span>Winner</span><strong>{result.winner_label || 'GMM'}</strong></div>
                </div>
                <div className="result-hero-actions">
                  <button className="btn btn-ghost" onClick={() => setTab('recommendations')}>What to play next</button>
                  {technicalHidden && <button className="btn btn-ghost" onClick={() => setShowTechnical(true)}>See detailed metrics</button>}
                </div>
              </div>

              <ExplainabilityDrawer result={result} />

              {/* Winner banner */}
              <WinnerCard result={result} />
              <ConsensusInsightsCard result={result} />

              {!technicalHidden && (
                <>
                  {/* Tabs */}
                  <div className="result-tabs">
                    {[
                      { id: 'algorithms',    label: '📊 Algorithm Results' },
                      { id: 'metrics',       label: '📈 Metric Comparison' },
                      { id: 'features',      label: '🔧 Feature Vector' },
                      { id: 'recommendations', label: '🎧 Recommendations' },
                    ].map(t => (
                      <button key={t.id} className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
                        onClick={() => setTab(t.id)}>
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="result-actions">
                    <button className="btn btn-ghost" onClick={clearResults}>Clear Results</button>
                    <button className="btn btn-ghost" onClick={copyJson}>
                      Copy JSON
                    </button>
                    <button className="btn btn-ghost" onClick={copyShareLink}>Copy Share Link</button>
                    <button className="btn btn-ghost" onClick={downloadJsonSnapshot}>Download Snapshot</button>
                    {copiedLabel && <span className="action-feedback">{copiedLabel}</span>}
                  </div>
                </>
              )}

              {technicalHidden && (
                <RecommendationsPanel
                  recommendations={result.recommendations}
                  mood={result.winner_mood}
                  color={result.winner_color}
                />
              )}

              {!technicalHidden && activeTab === 'algorithms' && (
                <div className="algo-results-stack">
                  {['kmeans', 'hdbscan', 'gmm'].map(alg => (
                    <AlgorithmResultCard key={alg} data={result.algorithms[alg]} />
                  ))}
                </div>
              )}

              {!technicalHidden && activeTab === 'metrics' && (
                <MetricsComparisonChart algorithms={result.algorithms} />
              )}

              {!technicalHidden && activeTab === 'features' && (
                <FeatureVectorDisplay vector={result.feature_vector} raw={result} />
              )}

              {!technicalHidden && activeTab === 'recommendations' && (
                <RecommendationsPanel
                  recommendations={result.recommendations}
                  mood={result.winner_mood}
                  color={result.winner_color}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Local demo result when backend is offline ─────────────────────────────────
function buildDemoResult(features) {
  const { energy = 0.5, valence = 0.5, acousticness = 0.3,
          danceability = 0.5, liveness = 0.15, speechiness = 0.05,
          instrumentalness = 0.05, tempo = 120,
          song_name = 'Unknown', artist_name = '' } = features;

  const alog  = Math.log1p(acousticness);
  const llog  = Math.log1p(liveness);
  const sc    = Math.min(speechiness, 0.33);
  const hv    = instrumentalness < 0.5 ? 1 : 0;
  const tn    = Math.min(Math.max((tempo - 30) / 220, 0), 1);
  const mev   = (energy + valence) / 2;
  const mdark = Math.min(((1 - valence) * alog * (1 - energy)) / 0.45, 1);
  const mgrv  = Math.min((danceability * tn * hv) / 0.6, 1);

  const fv = {
    mood_ev: +mev.toFixed(4), mood_groove: +mgrv.toFixed(4),
    mood_dark: +mdark.toFixed(4), acousticness_log: +alog.toFixed(4),
    liveness_log: +llog.toFixed(4), speechiness_capped: +sc.toFixed(4),
  };

  let kmLabel, hdbLabel, gmmLabel, winnerMood, winnerColor, winnerEmoji;

  if (mdark > 0.45 && alog > 0.4) {
    kmLabel = 0; hdbLabel = 0; gmmLabel = 1;
    winnerMood = 'Melancholic / Acoustic'; winnerColor = '#8B6BB1'; winnerEmoji = '🌧️';
  } else if (mev > 0.62 && mgrv > 0.25) {
    kmLabel = 1; hdbLabel = 3; gmmLabel = 0;
    winnerMood = 'High Energy / Mainstream'; winnerColor = '#E07B54'; winnerEmoji = '🔥';
  } else if (mev > 0.60 && alog < 0.2) {
    kmLabel = 2; hdbLabel = 1; gmmLabel = 2;
    winnerMood = 'Live / Electronic'; winnerColor = '#4A90D9'; winnerEmoji = '🎧';
  } else {
    kmLabel = 3; hdbLabel = 2; gmmLabel = 3;
    winnerMood = 'Introspective / Indie'; winnerColor = '#3D7A5E'; winnerEmoji = '🌿';
  }

  // Label → cluster keyed to the trained models' actual numbering (verified
  // against per-label feature means on the dataset — matches the backend).
  const CLUSTER_DATA = {
    kmeans: {
      0: { name: 'Melancholic / Acoustic', color: '#8B6BB1', emoji: '🌧️', desc: 'Highest mood_dark, acoustic.' },
      1: { name: 'High Energy / Mainstream', color: '#E07B54', emoji: '🔥', desc: 'Mainstream produced music.' },
      2: { name: 'Energetic / Upbeat', color: '#4A90D9', emoji: '⚡', desc: 'High energy, strong liveness.' },
      3: { name: 'Indie / Mid-Tempo', color: '#3D7A5E', emoji: '🌿', desc: 'Balanced, emotionally complex.' },
    },
    hdbscan: {
      0: { name: 'Melancholic / Acoustic', color: '#8B6BB1', emoji: '🌧️', desc: 'Piano, folk, classical.' },
      1: { name: 'Cinematic / Electronic', color: '#4A90D9', emoji: '🎬', desc: 'Instrumental electronic.' },
      2: { name: 'Bittersweet / Acoustic', color: '#3D7A5E', emoji: '🍂', desc: 'Sad with movement.' },
      3: { name: 'High Energy / Mainstream', color: '#E07B54', emoji: '🔥', desc: 'Confirmed by all algos.' },
      [-1]: { name: 'Noise / Boundary', color: '#888', emoji: '〰️', desc: 'Between moods.' },
    },
    gmm: {
      0: { name: 'High Energy / Mainstream', color: '#E07B54', emoji: '🔥', desc: 'Largest cluster, ~67%.' },
      1: { name: 'Melancholic / Acoustic', color: '#8B6BB1', emoji: '🌧️', desc: 'Highest mood_dark, acoustic.' },
      2: { name: 'Live / Electronic', color: '#4A90D9', emoji: '🎧', desc: 'High liveness (0.523).' },
      3: { name: 'Introspective / Indie', color: '#3D7A5E', emoji: '🌿', desc: 'Complex acoustic tracks.' },
    },
  };

  const makeProbs = (label) => {
    const p = [0.05, 0.05, 0.05, 0.05];
    p[label] = 0.80; const t = p.reduce((a, b) => a + b, 0);
    return [0,1,2,3].map(i => ({
      cluster_id: i, probability: +(p[i]/t).toFixed(4),
      cluster_name: CLUSTER_DATA.gmm[i].name,
      color: CLUSTER_DATA.gmm[i].color, emoji: CLUSTER_DATA.gmm[i].emoji,
    })).sort((a, b) => b.probability - a.probability);
  };

  const profile = { mood_ev: +mev.toFixed(3), mood_dark: +mdark.toFixed(3), mood_groove: +mgrv.toFixed(3), acousticness_log: +alog.toFixed(3), liveness_log: +llog.toFixed(3) };
  const metrics = {
    kmeans:  { silhouette: 0.3426, davies_bouldin: 1.0252, calinski_harabasz: 79060, silhouette_rank: 3, db_rank: 2, ch_rank: 1, note: null },
    hdbscan: { silhouette: 0.3937, davies_bouldin: 1.0058, calinski_harabasz: 57801, silhouette_rank: 1, db_rank: 3, ch_rank: 3, note: 'Silhouette on 44.4% non-noise only' },
    gmm:     { silhouette: 0.3867, davies_bouldin: 0.8878, calinski_harabasz: 76641, silhouette_rank: 2, db_rank: 1, ch_rank: 2, note: null },
  };

  // Notebook profiles re-keyed to the trained models' label numbering
  // (kept in sync with backend CLUSTER_PROFILES).
  const CLUSTER_PROFILES = {
    kmeans:  { 0:{mood_ev:0.163,mood_dark:0.674,mood_groove:0.098,acousticness_log:0.646,liveness_log:0.135}, 1:{mood_ev:0.641,mood_dark:0.021,mood_groove:0.336,acousticness_log:0.132,liveness_log:0.146}, 2:{mood_ev:0.625,mood_dark:0.050,mood_groove:0.301,acousticness_log:0.231,liveness_log:0.491}, 3:{mood_ev:0.384,mood_dark:0.268,mood_groove:0.268,acousticness_log:0.498,liveness_log:0.140} },
    hdbscan: { 0:{mood_ev:0.169,mood_dark:0.681,mood_groove:0.000,acousticness_log:0.658,liveness_log:0.100}, 1:{mood_ev:0.563,mood_dark:0.010,mood_groove:0.000,acousticness_log:0.027,liveness_log:0.150}, 2:{mood_ev:0.341,mood_dark:0.384,mood_groove:0.307,acousticness_log:0.573,liveness_log:0.102}, 3:{mood_ev:0.657,mood_dark:0.007,mood_groove:0.378,acousticness_log:0.041,liveness_log:0.147}, [-1]:{mood_ev:0.543,mood_dark:0.140,mood_groove:0.333,acousticness_log:0.337,liveness_log:0.221} },
    gmm:     { 0:{mood_ev:0.631,mood_dark:0.028,mood_groove:0.333,acousticness_log:0.148,liveness_log:0.152}, 1:{mood_ev:0.155,mood_dark:0.689,mood_groove:0.091,acousticness_log:0.649,liveness_log:0.134}, 2:{mood_ev:0.615,mood_dark:0.062,mood_groove:0.298,acousticness_log:0.256,liveness_log:0.523}, 3:{mood_ev:0.358,mood_dark:0.311,mood_groove:0.257,acousticness_log:0.529,liveness_log:0.136} },
  };

  const RECS = {
    'Melancholic / Acoustic': [{track:'River',artist:'Joni Mitchell',energy:0.24,valence:0.18,tempo:68},{track:'Skinny Love',artist:'Bon Iver',energy:0.28,valence:0.21,tempo:97},{track:'Holocene',artist:'Bon Iver',energy:0.31,valence:0.23,tempo:101},{track:'The Night We Met',artist:'Lord Huron',energy:0.32,valence:0.25,tempo:114},{track:'Lua',artist:'Bright Eyes',energy:0.19,valence:0.15,tempo:72},{track:'Motion Sickness',artist:'Phoebe Bridgers',energy:0.39,valence:0.20,tempo:108}],
    'High Energy / Mainstream': [{track:'Blinding Lights',artist:'The Weeknd',energy:0.73,valence:0.68,tempo:171},{track:'Uptown Funk',artist:'Mark Ronson',energy:0.85,valence:0.89,tempo:115},{track:'Levitating',artist:'Dua Lipa',energy:0.76,valence:0.79,tempo:103},{track:'Shape of You',artist:'Ed Sheeran',energy:0.65,valence:0.93,tempo:96},{track:'As It Was',artist:'Harry Styles',energy:0.73,valence:0.59,tempo:174},{track:'Anti-Hero',artist:'Taylor Swift',energy:0.64,valence:0.52,tempo:97}],
    'Live / Electronic': [{track:'God is a DJ (live)',artist:'Faithless',energy:0.82,valence:0.63,tempo:138},{track:'I Gotta Feeling (live)',artist:'Black Eyed Peas',energy:0.87,valence:0.91,tempo:128},{track:'Seven Nation Army (live)',artist:'The White Stripes',energy:0.78,valence:0.55,tempo:124},{track:'One More Time',artist:'Daft Punk',energy:0.79,valence:0.82,tempo:123},{track:'Around the World',artist:'Daft Punk',energy:0.83,valence:0.75,tempo:121},{track:'Daft Punk is Playing',artist:'LCD Soundsystem',energy:0.76,valence:0.71,tempo:120}],
    'Introspective / Indie': [{track:'Fake Plastic Trees',artist:'Radiohead',energy:0.30,valence:0.22,tempo:73},{track:'Re: Stacks',artist:'Bon Iver',energy:0.25,valence:0.20,tempo:65},{track:'Running Up That Hill',artist:'Kate Bush',energy:0.61,valence:0.45,tempo:102},{track:'Georgia',artist:'Vance Joy',energy:0.45,valence:0.58,tempo:94},{track:'Gravity',artist:'John Mayer',energy:0.33,valence:0.30,tempo:90},{track:'Stubborn Love',artist:'The Lumineers',energy:0.39,valence:0.48,tempo:103}],
  };

  return {
    song_name, artist_name, demo_mode: true,
    winner: 'gmm', winner_label: 'GMM (Gaussian Mixture Model)',
    winner_mood: winnerMood, winner_color: winnerColor, winner_emoji: winnerEmoji,
    winner_description: CLUSTER_DATA.gmm[gmmLabel].desc,
    winner_reason: 'GMM wins on Davies-Bouldin (0.8878) — the most neutral metric.',
    feature_vector: fv,
    recommendations: RECS[winnerMood] || RECS['High Energy / Mainstream'],
    algorithms: {
      kmeans: { id:'kmeans', name:'K-Means', subtitle:'k=4 · k-means++ · n_init=20', label:kmLabel, cluster_name:CLUSTER_DATA.kmeans[kmLabel].name, cluster_description:CLUSTER_DATA.kmeans[kmLabel].desc, color:CLUSTER_DATA.kmeans[kmLabel].color, emoji:CLUSTER_DATA.kmeans[kmLabel].emoji, confidence:0.87, is_winner:false, is_noise:false, metrics:metrics.kmeans, cluster_profile:CLUSTER_PROFILES.kmeans[kmLabel], all_cluster_profiles:CLUSTER_PROFILES.kmeans, cluster_names:Object.fromEntries(Object.entries(CLUSTER_DATA.kmeans).map(([k,v])=>[k,v.name])), cluster_colors:Object.fromEntries(Object.entries(CLUSTER_DATA.kmeans).map(([k,v])=>[k,v.color])) },
      hdbscan:{ id:'hdbscan', name:'HDBSCAN', subtitle:'mcs=750 · min_samples=10', label:hdbLabel, cluster_name:CLUSTER_DATA.hdbscan[hdbLabel]?.name||'Noise', cluster_description:CLUSTER_DATA.hdbscan[hdbLabel]?.desc||'Boundary.', color:CLUSTER_DATA.hdbscan[hdbLabel]?.color||'#888', emoji:CLUSTER_DATA.hdbscan[hdbLabel]?.emoji||'〰️', confidence:0.78, is_winner:false, is_noise:hdbLabel===-1, metrics:metrics.hdbscan, cluster_profile:CLUSTER_PROFILES.hdbscan[hdbLabel]||CLUSTER_PROFILES.hdbscan[0], all_cluster_profiles:CLUSTER_PROFILES.hdbscan, cluster_names:Object.fromEntries(Object.entries(CLUSTER_DATA.hdbscan).filter(([k])=>k!==-1).map(([k,v])=>[k,v.name])), cluster_colors:Object.fromEntries(Object.entries(CLUSTER_DATA.hdbscan).filter(([k])=>k!==-1).map(([k,v])=>[k,v.color])) },
      gmm:    { id:'gmm', name:'GMM', subtitle:'covariance=spherical · k=4', label:gmmLabel, cluster_name:CLUSTER_DATA.gmm[gmmLabel].name, cluster_description:CLUSTER_DATA.gmm[gmmLabel].desc, color:CLUSTER_DATA.gmm[gmmLabel].color, emoji:CLUSTER_DATA.gmm[gmmLabel].emoji, confidence:0.85, is_winner:true, is_noise:false, probabilities:makeProbs(gmmLabel), metrics:metrics.gmm, cluster_profile:CLUSTER_PROFILES.gmm[gmmLabel], all_cluster_profiles:CLUSTER_PROFILES.gmm, cluster_names:Object.fromEntries(Object.entries(CLUSTER_DATA.gmm).map(([k,v])=>[k,v.name])), cluster_colors:Object.fromEntries(Object.entries(CLUSTER_DATA.gmm).map(([k,v])=>[k,v.color])) },
    },
  };
}