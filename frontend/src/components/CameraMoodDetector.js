import React, { useEffect, useRef, useState } from 'react';
import './CameraMoodDetector.css';

/**
 * Camera-based mood detection (Phase 2 feature).
 * Runs face + emotion recognition fully in the browser using @vladmandic/human
 * (models served locally from /models/human/ — no frames ever leave the device).
 *
 * Accuracy is improved over a naive "average the raw scores" approach by:
 *  - Tightening the face crop fed to the 64×64 emotion net (emotion.crop) so it
 *    sees the face, not forehead/hair/background.
 *  - Raising the face-detector confidence/size floors so weak, tiny, or blurry
 *    detections never reach the (fragile) emotion classifier.
 *  - Per-frame normalizing each emotion vector into a probability distribution,
 *    then weighting every frame by face confidence × face size × lighting.
 *  - Combining a weighted mean of distributions with a weighted per-frame vote
 *    (robust to a few outlier frames flipping the result) + mild neutral damping.
 *  - Sampling frame brightness so we can warn the user when it's too dark.
 */

const EMOTION_TO_MOOD = {
  happy: 'happy',
  surprise: 'happy',
  sad: 'sad',
  angry: 'angry',
  disgust: 'angry',
  fear: 'angry',
  neutral: 'calm',
};

const EMOTION_LABELS = {
  happy: '😊 Happy',
  surprise: '😲 Surprise',
  sad: '😢 Sad',
  angry: '😡 Angry',
  disgust: '🤢 Disgust',
  fear: '😨 Fear',
  neutral: '😐 Neutral',
};

const MOOD_LABELS = {
  happy: '😊 Happy / Party',
  sad: '😢 Sad / Melancholy',
  angry: '😡 Angry / Intense',
  calm: '😌 Calm / Peaceful',
};

// Sampling strategy: more frames + a wider time span = more stable aggregate.
const FRAMES_NEEDED = 12;   // target usable frames before deciding
const MAX_FRAMES = 16;      // hard cap on frames collected
const MIN_FRAMES = 6;       // below this we don't trust the aggregate
const TICK_MS = 250;        // ~4 samples/sec
const MAX_ATTEMPTS = 64;    // backstop on loop iterations
// Wall-clock deadline. Each tick runs a full detect() + TICK_MS wait, so on slow
// devices the attempt-count alone can stretch far past its nominal ~16s. A real
// deadline bounds the wait no matter how slow detect() is (important for the
// no-face / give-up path so the user isn't left staring at a stuck spinner).
const MAX_SCAN_MS = 20000;  // no usable frames yet (no face) → give up ~20s
const MAX_SCAN_MS_SLOW = 60000; // face present, collecting → allow up to ~60s on slow devices

// Quality gates (these materially improve accuracy vs. accepting every frame).
const MIN_FACE_SCORE = 0.5;      // face-detector confidence floor
const MIN_FACE_FRAC = 0.14;      // face must be >=14% of frame width to read reliably
const DARK_LUMA = 45;            // mean face-region luminance (0-255) below = too dark
const DIM_LUMA = 80;             // below this, weight the frame down (but keep it)

// Weights for the combined final score (weighted mean of distributions + vote share).
const MEAN_WEIGHT = 0.6;
const VOTE_WEIGHT = 0.4;
const NEUTRAL_DAMP = 0.85;       // FER models over-predict neutral; nudge it down

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

export default function CameraMoodDetector({ onMoodDetected, disabled }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const humanRef = useRef(null);
  const timerRef = useRef(null);
  const framesRef = useRef([]);      // [{ dist:{emotion:p}, weight, top }]
  const attemptsRef = useRef(0);
  const scanStartedAtRef = useRef(0); // wall-clock start of the detection loop
  const stoppedRef = useRef(false);
  const canvasRef = useRef(null);    // offscreen canvas for luminance sampling
  const rejectRef = useRef({ noFace: 0, lowScore: 0, small: 0, dark: 0 });

  const [state, setState] = useState('idle');   // idle | loading | running | done | error
  const [live, setLive] = useState(null);       // { emotion, score } from latest usable frame
  const [progress, setProgress] = useState(0);  // 0..1 usable frames collected
  const [result, setResult] = useState(null);   // { mood, emotion, score, ranked, confidence }
  const [hint, setHint] = useState('');         // transient quality hint while running
  const [error, setError] = useState('');

  function stopCamera() {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function cleanup() {
    stoppedRef.current = true;
    stopCamera();
  }

  useEffect(() => cleanup, []);

  // Mean luminance (0-255) of the face-box region in the current video frame.
  // Returns null when it can't be measured.
  function faceLuma(video, box) {
    try {
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      if (!vw || !vh || !box) return null;
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
      const c = canvasRef.current;
      const W = 128;
      const H = Math.max(1, Math.round((vh / vw) * W));
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, W, H);
      const sx = W / vw, sy = H / vh;
      const x = clamp(Math.round(box[0] * sx), 0, W - 1);
      const y = clamp(Math.round(box[1] * sy), 0, H - 1);
      const w = clamp(Math.round(box[2] * sx), 1, W - x);
      const h = clamp(Math.round(box[3] * sy), 1, H - y);
      const data = ctx.getImageData(x, y, w, h).data;
      let sum = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        n += 1;
      }
      return n ? sum / n : null;
    } catch (e) {
      return null; // tainted canvas / no frame — treat as "unknown"
    }
  }

  async function start() {
    if (disabled) return;
    stoppedRef.current = false;
    framesRef.current = [];
    attemptsRef.current = 0;
    scanStartedAtRef.current = Date.now();
    rejectRef.current = { noFace: 0, lowScore: 0, small: 0, dark: 0 };
    setLive(null);
    setProgress(0);
    setResult(null);
    setHint('');
    setError('');
    setState('loading');

    try {
      // 1) Camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      if (stoppedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      // 2) Human (lazy-loaded bundle; models from /models/human/)
      setState('loading');
      if (!humanRef.current) {
        const mod = await import('@vladmandic/human');
        const Human = mod.default || mod.Human;
        humanRef.current = new Human({
          // NOTE: the config key is `modelBasePath` — passing `modelPath` here is
          // silently ignored and human falls back to "../models/", which 404s.
          modelBasePath: '/models/human/',
          backend: 'webgl',
          // Only the models we actually need: face detection + emotion.
          face: {
            enabled: true,
            mesh: { enabled: false },
            iris: { enabled: false },
            description: { enabled: false },
            // Face detection: reject weak / tiny / partial detections. The 64×64
            // emotion net is very sensitive to input quality, so a higher floor
            // here beats feeding it garbage crops.
            detector: {
              enabled: true,
              minConfidence: MIN_FACE_SCORE, // default 0.2 is too permissive
              minSize: 120,                  // default 0 accepts tiny far-away faces
              maxDetected: 1,
            },
            // Emotion: inset the face box (crop 0.1 => keep central ~80%) so the
            // classifier sees the face region it was trained on, and raise the
            // per-label confidence floor to drop near-noise scores.
            emotion: { enabled: true, crop: 0.1, minConfidence: 0.2 },
          },
          body: { enabled: false },
          hand: { enabled: false },
          gesture: { enabled: false },
          object: { enabled: false },
          segmentation: { enabled: false },
        });
        try {
          await humanRef.current.load();
        } catch (e) {
          console.error('Human.js model load failed:', e);
          throw new Error(
            'Could not load the AI models from /models/human/. ' +
            'Make sure the frontend dev server is serving the public/ folder.'
          );
        }
        try { await humanRef.current.warmup(); } catch (e) { /* warmup optional */ }
      }
      if (stoppedRef.current) return;

      // 3) Detection loop
      setState('running');
      const human = humanRef.current;

      const tick = async () => {
        if (stoppedRef.current) return;
        attemptsRef.current += 1;
        let reject = null;
        try {
          const res = await human.detect(video);
          const face = res?.face?.[0];
          const emotions = face?.emotion || [];

          if (!face) {
            reject = 'noFace';
          } else if ((face.score ?? 1) < MIN_FACE_SCORE) {
            reject = 'lowScore';
          } else {
            const vw = video.videoWidth || 640;
            const faceFrac = (face.box?.[2] || 0) / vw;
            const luma = faceLuma(video, face.box);

            if (faceFrac < MIN_FACE_FRAC) {
              reject = 'small';
            } else if (luma != null && luma < DARK_LUMA) {
              reject = 'dark';
            } else if (emotions.length) {
              // Normalize the emotion vector into a proper distribution
              // (labels below minConfidence were dropped, so it may not sum to 1).
              const dist = {};
              let sum = 0;
              emotions.forEach(({ emotion, score }) => { dist[emotion] = score || 0; sum += score || 0; });
              if (sum > 0) Object.keys(dist).forEach((k) => { dist[k] /= sum; });

              // Per-frame weight: face confidence × face size × lighting.
              const sizeW = clamp(faceFrac / (MIN_FACE_FRAC * 2.5), 0.4, 1.2);
              const lightW = luma == null ? 1 : clamp(luma / DIM_LUMA, 0.3, 1);
              const weight = clamp((face.score ?? 1) * sizeW * lightW, 0.05, 1.5);

              const top = emotions[0].emotion;
              framesRef.current.push({ dist, weight, top });
              setLive({ emotion: top, score: emotions[0].score });
              setProgress(Math.min(1, framesRef.current.length / FRAMES_NEEDED));
              setHint(luma != null && luma < DIM_LUMA ? '💡 Brighten your lighting for a sharper read' : '');
            }
          }
        } catch (e) { /* skip failed frame */ }

        if (reject) {
          rejectRef.current[reject] = (rejectRef.current[reject] || 0) + 1;
          if (reject === 'dark') setHint('💡 It looks dark — face a light source');
          else if (reject === 'small') setHint('📏 Move a bit closer to the camera');
          else if (reject === 'noFace') setHint('🙂 No face detected — look at the camera');
        }

        const nFrames = framesRef.current.length;
        if (nFrames >= FRAMES_NEEDED || nFrames >= MAX_FRAMES) {
          finish();
          return;
        }
        const elapsed = Date.now() - scanStartedAtRef.current;
        // Fail fast when we have nothing usable (typically no face in view), but
        // give a present-but-slow detection more room to finish collecting frames
        // instead of aborting a run that's actually making progress.
        const deadline = nFrames > 0 ? MAX_SCAN_MS_SLOW : MAX_SCAN_MS;
        if (attemptsRef.current >= MAX_ATTEMPTS || elapsed >= deadline) {
          stopCamera();
          if (nFrames >= MIN_FRAMES) { finish(); return; }
          setState('error');
          setError(describeFailure());
          return;
        }
        timerRef.current = window.setTimeout(tick, TICK_MS);
      };

      tick();
    } catch (e) {
      stopCamera();
      setState('error');
      const msg = String(e?.message || e);
      if (/permission|NotAllowed/i.test(msg)) {
        setError('Camera permission denied. Allow camera access in your browser, or pick a mood manually below.');
      } else if (/NotFound|DevicesNotFound/i.test(msg)) {
        setError('No camera found. Pick a mood manually below.');
      } else {
        setError(`Camera unavailable: ${msg}. Pick a mood manually below.`);
      }
    }
  }

  // Turn the frame-rejection counters into a helpful, specific error message.
  function describeFailure() {
    const r = rejectRef.current;
    const worst = Object.entries(r).sort((a, b) => b[1] - a[1])[0];
    let tip = 'Make sure your face is visible, reasonably close, and well-lit, then try again.';
    if (worst && worst[0] === 'dark') tip = 'It was too dark to read your expression. Face a light source (or turn one on) and try again.';
    else if (worst && worst[0] === 'small') tip = 'Move closer to the camera so your face fills more of the frame, then try again.';
    else if (worst && worst[0] === 'noFace') tip = 'No face was detected. Look toward the camera in a well-lit spot and try again.';
    return `Couldn\'t read your expression reliably. ${tip}`;
  }

  // Robust aggregate: weighted mean of per-frame distributions blended with a
  // weighted per-frame vote, then mild neutral damping. Returns ranked emotions.
  function aggregate() {
    const frames = framesRef.current;
    const totals = {};
    const votes = {};
    let wSum = 0;
    frames.forEach(({ dist, weight, top }) => {
      wSum += weight;
      Object.keys(dist).forEach((e) => { totals[e] = (totals[e] || 0) + dist[e] * weight; });
      votes[top] = (votes[top] || 0) + weight;
    });
    if (wSum <= 0) return [];
    const mean = {};
    Object.keys(totals).forEach((e) => { mean[e] = totals[e] / wSum; });
    const voteShare = {};
    Object.keys(votes).forEach((e) => { voteShare[e] = votes[e] / wSum; });

    const all = new Set([...Object.keys(mean), ...Object.keys(voteShare)]);
    const ranked = [...all].map((emotion) => {
      const m = mean[emotion] || 0;
      const v = voteShare[emotion] || 0;
      let combined = MEAN_WEIGHT * m + VOTE_WEIGHT * v;
      if (emotion === 'neutral') combined *= NEUTRAL_DAMP;
      return { emotion, score: combined, mean: m };
    }).sort((a, b) => b.score - a.score);
    return ranked;
  }

  function finish() {
    stopCamera();
    const ranked = aggregate();
    if (!ranked.length) {
      setState('error');
      setError(describeFailure());
      return;
    }
    const top = ranked[0];
    const mood = EMOTION_TO_MOOD[top.emotion] || 'calm';
    // Cap displayed confidence at 99% — a webcam FER read is never certain.
    const confidence = clamp(top.score, 0, 0.99);
    setResult({
      mood,
      emotion: top.emotion,
      score: confidence,
      confidence,
      ranked: ranked.slice(0, 3),
      frames: framesRef.current.length,
    });
    setState('done');
    if (onMoodDetected) {
      onMoodDetected(mood, { emotion: top.emotion, score: confidence, confidence });
    }
  }

  return (
    <div className="camera-card card">
      <div className="card-title">📷 Detect your mood with the camera</div>
      <p className="camera-note">
        Face + emotion recognition runs <strong>entirely in your browser</strong> (Human.js, local models).
        No video frames are uploaded anywhere.
      </p>

      <div className={`camera-stage ${state === 'running' || state === 'loading' ? 'active' : ''}`}>
        <video ref={videoRef} className="camera-video" playsInline muted />
        {state !== 'running' && state !== 'loading' && (
          <div className="camera-placeholder">🎥 Camera off</div>
        )}
        {state === 'running' && live && (
          <div className="camera-live-badge">
            {EMOTION_LABELS[live.emotion] || live.emotion} · {Math.round(live.score * 100)}%
          </div>
        )}
        {state === 'loading' && <div className="camera-overlay">⏳ Loading camera / models…</div>}
      </div>

      {state === 'running' && (
        <>
          <div className="camera-progress-wrap">
            <div className="camera-progress" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span className="camera-progress-text">Analyzing expression… {Math.round(progress * 100)}%</span>
          </div>
          {hint && <div className="camera-hint">{hint}</div>}
        </>
      )}

      {state === 'done' && result && (
        <div className="camera-result">
          <div className="camera-result-mood">{MOOD_LABELS[result.mood]}</div>
          <div className="camera-result-sub">
            Detected: {EMOTION_LABELS[result.emotion] || result.emotion} ({Math.round(result.confidence * 100)}%)
            over {result.frames} frames — loading your playlist…
          </div>
        </div>
      )}

      {state === 'error' && <div className="camera-error">{error}</div>}

      <div className="camera-actions">
        {(state === 'idle' || state === 'error') && (
          <button className="btn btn-primary" onClick={start} disabled={disabled}>
            🎤 Start camera detection
          </button>
        )}
        {state === 'done' && (
          <button className="btn btn-ghost" onClick={start} disabled={disabled}>
            🔄 Detect again
          </button>
        )}
        {(state === 'running' || state === 'loading') && (
          <button className="btn btn-ghost" onClick={() => { cleanup(); setState('idle'); setError(''); setHint(''); }}>
            ✋ Stop
          </button>
        )}
      </div>
    </div>
  );
}
