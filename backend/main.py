"""
Music Mood Clustering - FastAPI Backend
=======================================
Run with:  uvicorn main:app --reload --port 8756

Project: Unsupervised ML clustering of songs by mood
Live metadata + search: YouTube Data API (free API key, no premium account)
Algorithms: K-Means (k=4), HDBSCAN (mcs=750), GMM (spherical k=4)
Winner: GMM - best Davies-Bouldin score (0.8878)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict
import numpy as np
import pandas as pd
import pickle
import os
import re
import time
import hashlib
import itertools
import requests
import warnings
import unicodedata
from difflib import SequenceMatcher
from urllib.parse import quote as url_quote
warnings.filterwarnings("ignore")


def _load_env_file_if_present():
    """Load KEY=VALUE pairs from backend/.env or project-root .env into process env."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, ".env"),
        os.path.join(os.path.dirname(base_dir), ".env"),
    ]

    for env_path in candidates:
        if not os.path.exists(env_path):
            continue

        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
            break
        except Exception:
            # If parsing fails, continue with existing process environment.
            pass


_load_env_file_if_present()

# ─────────────────────────────────────────────────────────────────────────────
# App setup
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Music Mood Clustering API",
    description="Song mood detection using K-Means, HDBSCAN and GMM clustering, with YouTube search",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # React dev server on localhost:3000
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Model loading
# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR  = os.path.join(BASE_DIR, "models")

models  = {}
scalers = {}
DEMO_MODE = False

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3"

def try_load(path):
    try:
        print(f"Trying to load: {path}")   # 👈 ADD THIS
        with open(path, "rb") as f:
            return pickle.load(f)
    except Exception as e:
        print(f"❌ Failed to load {path}: {e}")   # 👈 ADD THIS
        return None

def load_all_models():
    global DEMO_MODE
    km  = try_load(os.path.join(MODEL_DIR, "km_aug.pkl"))
    hdb = try_load(os.path.join(MODEL_DIR, "hdb_final.pkl"))
    gmm = try_load(os.path.join(MODEL_DIR, "gmm_final.pkl"))
    sa  = try_load(os.path.join(MODEL_DIR, "scaler_aug.pkl"))

    if all(x is not None for x in [km, hdb, gmm, sa]):
        models["kmeans"]   = km
        models["hdbscan"]  = hdb
        models["gmm"]      = gmm
        scalers["aug"]     = sa
        DEMO_MODE = False
        print("✅  All models loaded successfully — real predictions active.")
    else:
        DEMO_MODE = True
        print("⚠️   Model files not found — running in DEMO MODE.")
        print(f"     Expected location: {MODEL_DIR}/")

load_all_models()

# ─────────────────────────────────────────────────────────────────────────────
# Cluster definitions (from Phase 4 of the notebook)
#
# IMPORTANT: label → cluster assignments below were re-verified against the
# trained pickles on data1/df_feat.csv (per-label raw feature means). The
# notebook's display table listed clusters in a different order than the
# pickled models number them, so names follow the ACTUAL model output:
#   KMeans:  0=Melancholic, 1=High Energy/Mainstream (largest, ~62%),
#            2=Energetic/Upbeat (liveness), 3=Indie/Mid-Tempo
#   HDBSCAN: 0=Melancholic, 1=Cinematic/Electronic, 2=Bittersweet, 3=Mainstream
#   GMM:     0=High Energy/Mainstream (largest, ~67%), 1=Melancholic,
#            2=Live/Electronic (liveness 0.523), 3=Introspective/Indie
# ─────────────────────────────────────────────────────────────────────────────
KMEANS_CLUSTERS = {
    0: {"name": "Melancholic / Acoustic",   "color": "#8B6BB1", "emoji": "🌧️",
        "description": "Highest mood_dark (0.674), highest acousticness. Piano, folk, classical."},
    1: {"name": "High Energy / Mainstream", "color": "#E07B54", "emoji": "🔥",
        "description": "Largest cluster (~62% of dataset). Mainstream produced music across all sub-genres."},
    2: {"name": "Energetic / Upbeat",       "color": "#4A90D9", "emoji": "⚡",
        "description": "High energy, strong liveness signal. Wide genre range unified by intensity."},
    3: {"name": "Indie / Mid-Tempo",        "color": "#3D7A5E", "emoji": "🌿",
        "description": "Balanced profile. Emotionally complex tracks in the middle ground."},
}

HDBSCAN_CLUSTERS = {
    0:  {"name": "Melancholic / Acoustic",   "color": "#8B6BB1", "emoji": "🌧️",
         "description": "Most coherent cluster. Piano, folk, classical. Matches K-Means cluster 0."},
    1:  {"name": "Cinematic / Electronic",   "color": "#4A90D9", "emoji": "🎬",
         "description": "High energy, near-zero groove. Instrumental electronic and cinematic scores."},
    2:  {"name": "Bittersweet / Acoustic",   "color": "#3D7A5E", "emoji": "🍂",
         "description": "Sad but with movement. Singer-songwriter with rhythm. K-Means missed this."},
    3:  {"name": "High Energy / Mainstream", "color": "#E07B54", "emoji": "🔥",
         "description": "Directly matches K-Means cluster 1. Confirmed by both algorithms."},
    -1: {"name": "Noise / Boundary Song",    "color": "#888888", "emoji": "〰️",
         "description": "Song sits between moods. HDBSCAN says it cannot confidently assign a cluster."},
}

GMM_CLUSTERS = {
    0: {"name": "High Energy / Mainstream",  "color": "#E07B54", "emoji": "🔥",
        "description": "Largest component (~67% of dataset). Pop, electronic, mainstream produced music."},
    1: {"name": "Melancholic / Acoustic",    "color": "#8B6BB1", "emoji": "🌧️",
        "description": "Highest mood_dark (0.689) and acousticness. Norah Jones, folk, ambient."},
    2: {"name": "Live / Electronic",         "color": "#4A90D9", "emoji": "🎧",
        "description": "Defining feature is liveness (0.523). Live electronic and club recordings."},
    3: {"name": "Introspective / Indie",     "color": "#3D7A5E", "emoji": "🌿",
        "description": "Elevated mood_dark and acousticness. Emotionally complex acoustic tracks."},
}

# ─────────────────────────────────────────────────────────────────────────────
# Cluster feature profiles: TRUE per-label means of the stored engineered
# features on data1/df_feat.csv (groupby each model's own label vector).
# Label order verified via these same means:
#   kmeans:  0=melancholic, 1=mainstream, 2=energetic(liveness), 3=indie
#   hdbscan: 0=melancholic, 1=cinematic,   2=bittersweet,        3=mainstream
#   gmm:     0=mainstream,  1=melancholic, 2=live(liveness),     3=introspective
# NOTE: these are static FALLBACKS (DEMO_MODE / no data). At startup
# _build_cluster_profiles() recomputes them from the live data + models.
# ─────────────────────────────────────────────────────────────────────────────
CLUSTER_PROFILES = {
    "kmeans": {
        0: {"mood_ev": 0.163, "mood_dark": 0.674, "mood_groove": 0.098, "acousticness_log": 0.646, "liveness_log": 0.135},
        1: {"mood_ev": 0.641, "mood_dark": 0.021, "mood_groove": 0.336, "acousticness_log": 0.132, "liveness_log": 0.146},
        2: {"mood_ev": 0.625, "mood_dark": 0.050, "mood_groove": 0.301, "acousticness_log": 0.231, "liveness_log": 0.491},
        3: {"mood_ev": 0.384, "mood_dark": 0.268, "mood_groove": 0.268, "acousticness_log": 0.498, "liveness_log": 0.140},
    },
    "hdbscan": {
        0:  {"mood_ev": 0.169, "mood_dark": 0.681, "mood_groove": 0.000, "acousticness_log": 0.658, "liveness_log": 0.100},
        1:  {"mood_ev": 0.563, "mood_dark": 0.010, "mood_groove": 0.000, "acousticness_log": 0.027, "liveness_log": 0.150},
        2:  {"mood_ev": 0.341, "mood_dark": 0.384, "mood_groove": 0.307, "acousticness_log": 0.573, "liveness_log": 0.102},
        3:  {"mood_ev": 0.657, "mood_dark": 0.007, "mood_groove": 0.378, "acousticness_log": 0.041, "liveness_log": 0.147},
        -1: {"mood_ev": 0.543, "mood_dark": 0.140, "mood_groove": 0.333, "acousticness_log": 0.337, "liveness_log": 0.221},
    },
    "gmm": {
        0: {"mood_ev": 0.631, "mood_dark": 0.028, "mood_groove": 0.333, "acousticness_log": 0.148, "liveness_log": 0.152},
        1: {"mood_ev": 0.155, "mood_dark": 0.689, "mood_groove": 0.091, "acousticness_log": 0.649, "liveness_log": 0.134},
        2: {"mood_ev": 0.615, "mood_dark": 0.062, "mood_groove": 0.298, "acousticness_log": 0.256, "liveness_log": 0.523},
        3: {"mood_ev": 0.358, "mood_dark": 0.311, "mood_groove": 0.257, "acousticness_log": 0.529, "liveness_log": 0.136},
    }
}

# Actual metrics from Phase 4 notebook
ALGORITHM_METRICS = {
    "kmeans":  {
        "silhouette": 0.3426, "davies_bouldin": 1.0252, "calinski_harabasz": 79060,
        "silhouette_rank": 3, "db_rank": 2, "ch_rank": 1,
        "note": None
    },
    "hdbscan": {
        "silhouette": 0.3937, "davies_bouldin": 1.0058, "calinski_harabasz": 57801,
        "silhouette_rank": 1, "db_rank": 3, "ch_rank": 3,
        "note": "Silhouette computed on 44.4% non-noise points only"
    },
    "gmm": {
        "silhouette": 0.3867, "davies_bouldin": 0.8878, "calinski_harabasz": 76641,
        "silhouette_rank": 2, "db_rank": 1, "ch_rank": 2,
        "note": None
    },
}

# Recommendations per mood (curated examples matching each cluster's profile)
RECOMMENDATIONS = {
    "Melancholic / Acoustic": [
        {"track": "River",               "artist": "Joni Mitchell",    "energy": 0.24, "valence": 0.18, "tempo": 68},
        {"track": "Skinny Love",         "artist": "Bon Iver",         "energy": 0.28, "valence": 0.21, "tempo": 97},
        {"track": "Holocene",            "artist": "Bon Iver",         "energy": 0.31, "valence": 0.23, "tempo": 101},
        {"track": "The Night We Met",    "artist": "Lord Huron",       "energy": 0.32, "valence": 0.25, "tempo": 114},
        {"track": "Lua",                 "artist": "Bright Eyes",      "energy": 0.19, "valence": 0.15, "tempo": 72},
        {"track": "Motion Sickness",     "artist": "Phoebe Bridgers",  "energy": 0.39, "valence": 0.20, "tempo": 108},
    ],
    "High Energy / Mainstream": [
        {"track": "Blinding Lights",     "artist": "The Weeknd",       "energy": 0.73, "valence": 0.68, "tempo": 171},
        {"track": "Uptown Funk",         "artist": "Mark Ronson",      "energy": 0.85, "valence": 0.89, "tempo": 115},
        {"track": "Levitating",          "artist": "Dua Lipa",         "energy": 0.76, "valence": 0.79, "tempo": 103},
        {"track": "Shape of You",        "artist": "Ed Sheeran",       "energy": 0.65, "valence": 0.93, "tempo": 96},
        {"track": "As It Was",           "artist": "Harry Styles",     "energy": 0.73, "valence": 0.59, "tempo": 174},
        {"track": "Anti-Hero",           "artist": "Taylor Swift",     "energy": 0.64, "valence": 0.52, "tempo": 97},
    ],
    "Energetic / Upbeat": [
        {"track": "Thunderstruck",       "artist": "AC/DC",            "energy": 0.91, "valence": 0.72, "tempo": 134},
        {"track": "Mr. Brightside",      "artist": "The Killers",      "energy": 0.84, "valence": 0.65, "tempo": 148},
        {"track": "Numb",                "artist": "Linkin Park",      "energy": 0.82, "valence": 0.22, "tempo": 93},
        {"track": "In The End",          "artist": "Linkin Park",      "energy": 0.78, "valence": 0.26, "tempo": 105},
        {"track": "Smells Like Teen Spirit","artist": "Nirvana",       "energy": 0.88, "valence": 0.43, "tempo": 117},
        {"track": "Welcome to the Black Parade","artist": "My Chemical Romance","energy": 0.86,"valence": 0.31,"tempo": 96},
    ],
    "Indie / Mid-Tempo": [
        {"track": "Running Up That Hill","artist": "Kate Bush",        "energy": 0.61, "valence": 0.45, "tempo": 102},
        {"track": "Dog Days Are Over",   "artist": "Florence + The Machine","energy": 0.55,"valence": 0.72,"tempo": 109},
        {"track": "This Must Be the Place","artist": "Talking Heads",  "energy": 0.52, "valence": 0.76, "tempo": 96},
        {"track": "Shake It Out",        "artist": "Florence + The Machine","energy": 0.54,"valence": 0.36,"tempo": 101},
        {"track": "Fake Plastic Trees",  "artist": "Radiohead",        "energy": 0.30, "valence": 0.22, "tempo": 73},
        {"track": "Breathe (2 AM)",      "artist": "Anna Nalick",      "energy": 0.32, "valence": 0.33, "tempo": 80},
    ],
    "Cinematic / Electronic": [
        {"track": "Strobe",              "artist": "deadmau5",         "energy": 0.52, "valence": 0.35, "tempo": 128},
        {"track": "Time",                "artist": "Hans Zimmer",      "energy": 0.40, "valence": 0.25, "tempo": 72},
        {"track": "Teardrop",            "artist": "Massive Attack",   "energy": 0.46, "valence": 0.30, "tempo": 99},
        {"track": "Music For Airports",  "artist": "Brian Eno",        "energy": 0.12, "valence": 0.40, "tempo": 65},
        {"track": "Circumambient",       "artist": "Boards of Canada", "energy": 0.38, "valence": 0.31, "tempo": 89},
        {"track": "On My Way",           "artist": "Ben Harper",       "energy": 0.44, "valence": 0.38, "tempo": 90},
    ],
    "Bittersweet / Acoustic": [
        {"track": "Someone Like You",    "artist": "Adele",            "energy": 0.38, "valence": 0.28, "tempo": 68},
        {"track": "Landslide",           "artist": "Fleetwood Mac",    "energy": 0.26, "valence": 0.42, "tempo": 80},
        {"track": "Fast Car",            "artist": "Tracy Chapman",    "energy": 0.48, "valence": 0.45, "tempo": 100},
        {"track": "Vienna",              "artist": "Billy Joel",       "energy": 0.35, "valence": 0.52, "tempo": 76},
        {"track": "The Story",           "artist": "Brandi Carlile",   "energy": 0.41, "valence": 0.35, "tempo": 78},
        {"track": "Gravity",             "artist": "John Mayer",       "energy": 0.33, "valence": 0.30, "tempo": 90},
    ],
    "Live / Electronic": [
        {"track": "God is a DJ (live)",  "artist": "Faithless",        "energy": 0.82, "valence": 0.63, "tempo": 138},
        {"track": "I Gotta Feeling (live)","artist": "Black Eyed Peas","energy": 0.87, "valence": 0.91, "tempo": 128},
        {"track": "Seven Nation Army (live)","artist": "The White Stripes","energy": 0.78,"valence": 0.55,"tempo": 124},
        {"track": "Daft Punk is Playing","artist": "LCD Soundsystem",  "energy": 0.76, "valence": 0.71, "tempo": 120},
        {"track": "One More Time",       "artist": "Daft Punk",        "energy": 0.79, "valence": 0.82, "tempo": 123},
        {"track": "Around the World",    "artist": "Daft Punk",        "energy": 0.83, "valence": 0.75, "tempo": 121},
    ],
    "Introspective / Indie": [
        {"track": "Fake Plastic Trees",  "artist": "Radiohead",        "energy": 0.30, "valence": 0.22, "tempo": 73},
        {"track": "Re: Stacks",          "artist": "Bon Iver",         "energy": 0.25, "valence": 0.20, "tempo": 65},
        {"track": "Have It All",         "artist": "Jason Mraz",       "energy": 0.46, "valence": 0.76, "tempo": 85},
        {"track": "Breathe (2 AM)",      "artist": "Anna Nalick",      "energy": 0.32, "valence": 0.33, "tempo": 80},
        {"track": "Georgia",             "artist": "Vance Joy",        "energy": 0.45, "valence": 0.58, "tempo": 94},
        {"track": "Stubborn Love",       "artist": "The Lumineers",    "energy": 0.39, "valence": 0.48, "tempo": 103},
    ],
    "Noise / Boundary Song": [
        {"track": "Creep",               "artist": "Radiohead",        "energy": 0.49, "valence": 0.26, "tempo": 92},
        {"track": "Mad World",           "artist": "Tears for Fears",  "energy": 0.36, "valence": 0.19, "tempo": 88},
        {"track": "Hallelujah",          "artist": "Jeff Buckley",     "energy": 0.28, "valence": 0.31, "tempo": 72},
        {"track": "The Sound of Silence","artist": "Simon & Garfunkel","energy": 0.26, "valence": 0.28, "tempo": 78},
        {"track": "Black",               "artist": "Pearl Jam",        "energy": 0.44, "valence": 0.27, "tempo": 74},
        {"track": "Hurt",                "artist": "Nine Inch Nails",  "energy": 0.42, "valence": 0.22, "tempo": 99},
    ],
}

def get_recommendations(mood_name: str) -> list:
    """Get recommendations for a mood, with fallback."""
    for key in RECOMMENDATIONS:
        if key in mood_name or mood_name in key:
            return RECOMMENDATIONS[key]
    return RECOMMENDATIONS["High Energy / Mainstream"]


# ─────────────────────────────────────────────────────────────────────────────
# MoodMatch — mood-based playlist generation (core feature from project spec)
# Four simple moods positioned by musical valence ("positivity") and energy.
# KMeans clusters are labeled by inspecting their average valence/energy —
# exactly the manual-labeling step described in the project note.
# ─────────────────────────────────────────────────────────────────────────────
MOOD_QUADRANTS = {
    "happy": {"emoji": "😊", "name": "Happy / Party",   "valence": 0.75, "energy": 0.75,
              "description": "High valence + high energy — feel-good, upbeat, danceable."},
    "sad":   {"emoji": "😢", "name": "Sad / Melancholy", "valence": 0.20, "energy": 0.25,
              "description": "Low valence + low energy — emotional, slow, introspective."},
    "angry": {"emoji": "😡", "name": "Angry / Intense",  "valence": 0.25, "energy": 0.85,
              "description": "Low valence + high energy — aggressive, intense, driving."},
    "calm":  {"emoji": "😌", "name": "Calm / Peaceful",  "valence": 0.70, "energy": 0.20,
              "description": "High valence + low energy — relaxed, mellow, easy listening."},
}

MOOD_ALIASES = {
    "happy": "happy", "upbeat": "happy", "joy": "happy", "joyful": "happy", "party": "happy", "fun": "happy",
    "sad": "sad", "melancholy": "sad", "melancholic": "sad", "blue": "sad", "cry": "sad", "depressed": "sad",
    "angry": "angry", "anger": "angry", "intense": "angry", "aggressive": "angry", "metal": "angry", "rage": "angry",
    "calm": "calm", "chill": "calm", "relaxed": "calm", "peaceful": "calm", "mellow": "calm", "lofi": "calm", "lo-fi": "calm",
}

PLAYLIST_FEATURES = ["mood_ev", "mood_groove", "mood_dark", "acousticness_log", "liveness_log"]
PLAYLIST_MIN = 30  # minimum songs expected per mood for a healthy dataset

_playlist = {"df": None, "mood_to_cluster": {}, "cluster_to_mood": {}, "source": None,
             "title_index": {}}

# Words that appear in both titles and channels but say nothing about identity.
# Includes generic industry words: 'Dan Music' vs '11:11 Music Group' must NOT
# corroborate each other just because both contain 'music'.
_MATCH_STOPWORDS = {"the", "and", "official", "topic", "vevo", "hd", "remastered", "new", "video",
                    "music", "records", "record", "entertainment", "group", "label", "label(s)",
                    "studio", "studios", "production", "productions", "network", "radio", "artists"}


def _meaningful_tokens(s: str) -> set:
    """Lowercased tokens that can identify an artist (stopwords/generics dropped)."""
    return {t for t in str(s or "").split() if t and t not in _MATCH_STOPWORDS}


def _norm_match_text(s) -> str:
    """Normalize a title/artist/channel string for fuzzy dataset lookup:
    strip accents, drop bracketed junk like '(Official Video)', lowercase."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("utf-8", "ignore")
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[\(\[].{0,80}?[\)\]]", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _split_yt_title(raw: str) -> tuple:
    """Split a YouTube title into (artist_hint, title_parts).

    'Billie Eilish - TV (Official Lyric Video)' → ('billie eilish', ['TV (Official Lyric Video)'])
    The segment BEFORE the dash is conventionally the artist; the song follows it.
    No separator → ('', [whole title])."""
    parts = re.split(r"\s+[–—|]\s+|\s+-\s+", str(raw or "").strip())
    if len(parts) > 1:
        return _norm_match_text(parts[0]), parts[1:]
    return "", parts


def _title_variants(title) -> list:
    """Candidate song titles extracted from a YouTube title, best guess first.

    'Tate McRae - you broke me first (Official Video)' → ['you broke me first', ...]

    Two rules learned from a real wrong-match bug ('Billie Eilish - TV' matched
    Armani White's track titled 'BILLIE EILISH.'):
    1. The pre-dash ARTIST segment is never a title candidate — it is passed
       to _split_yt_title() and used only for artist corroboration.
    2. Short names are kept everywhere (min 2 chars): 'TV', 'NDA' are real
       titles — acceptance safety now comes from the corroboration rules in
       _dataset_match_features(), not from variant length."""
    raw = str(title or "")
    artist_hint, title_parts = _split_yt_title(raw)
    out, seen = [], set()

    def add(t, min_len):
        n = _norm_match_text(t)
        if len(n) >= min_len and n not in seen:
            seen.add(n)
            out.append(n)

    if artist_hint:
        for p in reversed(title_parts):   # the song follows the dash
            add(p, 2)
    else:
        # min-2 for single words too: variant length no longer decides trust —
        # the corroboration/distinctiveness rules in _dataset_match_features do.
        for p in title_parts:
            n = _norm_match_text(p)
            add(p, 2 if len(n.split()) == 1 else 3)
    add(raw, 3)
    return out


def _artist_bonus(artist_n: str, channel_n: str, channel_tokens: set = None) -> float:
    """Score how well a dataset artist matches the YouTube channel name.
    (`channel_tokens` may be omitted — generic/stopword tokens are dropped here.)"""
    if not artist_n or not channel_n:
        return 0.0
    a_tokens = {t for t in _meaningful_tokens(artist_n) if len(t) >= 3}
    channel_tokens = _meaningful_tokens(channel_n)
    if a_tokens & channel_tokens:
        return 2.0
    # VEVO-style channels: "adelevevo" contains "adele"
    if any(t in channel_n for t in a_tokens if len(t) >= 4):
        return 2.0
    if any(t in artist_n for t in channel_tokens if len(t) >= 4):
        return 1.5
    return 0.0


def _load_playlist_data():
    """Load the engineered dataset and label KMeans clusters by their average
    valence/energy via optimal quadrant matching against the four spec moods."""
    df = pd.read_csv(os.path.join(BASE_DIR, "data1", "df_feat.csv"))
    df = df.dropna(subset=["track_name"]).reset_index(drop=True)

    if all(x is not None for x in [scalers.get("aug"), models.get("kmeans")]):
        X_aug = df[PLAYLIST_FEATURES].to_numpy(dtype=float)
        labels = models["kmeans"].predict(scalers["aug"].transform(X_aug))
        source = "kmeans_clusters"
    else:
        # Fallback (demo mode): quadrant thresholds on raw valence/energy,
        # still faithful to the spec's valence/energy labeling idea.
        labels = np.where(
            (df["valence"] >= 0.5) & (df["energy"] >= 0.5), 0,
            np.where((df["valence"] < 0.5) & (df["energy"] < 0.5), 1,
                     np.where((df["valence"] < 0.5) & (df["energy"] >= 0.5), 2, 3)))
        source = "quadrant_thresholds"

    df = df.assign(cluster=labels)
    cluster_means = df.groupby("cluster")[["valence", "energy"]].mean()
    cluster_ids = sorted(df["cluster"].unique())
    mood_keys = list(MOOD_QUADRANTS.keys())

    best_perm, best_cost = None, float("inf")
    if len(cluster_ids) == len(mood_keys):
        # Brute-force over 4! = 24 assignments: every mood gets exactly one
        # cluster, minimizing total (valence, energy) distance to the quadrant.
        for perm in itertools.permutations(cluster_ids):
            cost = sum(
                (float(cluster_means.loc[c, "valence"]) - MOOD_QUADRANTS[m]["valence"]) ** 2
                + (float(cluster_means.loc[c, "energy"]) - MOOD_QUADRANTS[m]["energy"]) ** 2
                for m, c in zip(mood_keys, perm)
            )
            if cost < best_cost:
                best_cost, best_perm = cost, perm
        mood_to_cluster = dict(zip(mood_keys, best_perm))
    else:
        # Degenerate case: nearest cluster per mood (a cluster may repeat)
        mood_to_cluster = {
            m: min(cluster_ids, key=lambda c: (
                (float(cluster_means.loc[c, "valence"]) - q["valence"]) ** 2
                + (float(cluster_means.loc[c, "energy"]) - q["energy"]) ** 2))
            for m, q in MOOD_QUADRANTS.items()
        }

    # Title index → lets YouTube videos be matched to dataset songs so real
    # audio features (not metadata guesses) can drive the analysis.
    title_index = {}
    for pos, (tname, artist) in enumerate(zip(df["track_name"], df["artists"])):
        if not pd.notna(tname):
            continue
        nt = _norm_match_text(tname)
        if len(nt) >= 2:   # short titles are real: 'TV', 'NDA', 'Up'...
            na = _norm_match_text(artist) if pd.notna(artist) else ""
            title_index.setdefault(nt, []).append((pos, na))

    _playlist.update({
        "df": df,
        "mood_to_cluster": mood_to_cluster,
        "cluster_to_mood": {c: m for m, c in mood_to_cluster.items()},
        "source": source,
        "title_index": title_index,
    })
    print(f"✅  MoodMatch playlist engine ready ({len(df)} songs, source={source}, "
          f"mood→cluster={mood_to_cluster}, title index={len(title_index)} keys)")


def _build_cluster_profiles():
    """Recompute CLUSTER_PROFILES from the live dataset + trained models.

    The original profile table was transcribed from the notebook by hand and
    drifted from what the pickled models actually group. Recomputing here
    keeps every profile chart (radar, bars, /clusters) provably in sync with
    the model that produced the labels.
    """
    df = _playlist.get("df")
    if df is None or not models.get("kmeans") or not models.get("gmm"):
        return  # DEMO_MODE / models missing — static fallbacks stay in place
    try:
        X = scalers["aug"].transform(df[PLAYLIST_FEATURES].to_numpy(float))
        label_sets = {
            "kmeans": models["kmeans"].predict(X),
            "gmm":    models["gmm"].predict(X),
        }
        try:
            from hdbscan.prediction import approximate_predict
            label_sets["hdbscan"] = approximate_predict(models["hdbscan"], X)[0]
        except Exception:
            pass

        for algo, labels in label_sets.items():
            labels = pd.Series(labels, index=df.index)
            prof = df[PLAYLIST_FEATURES].groupby(labels).mean().round(3)
            for cid, row in prof.iterrows():
                cid = int(cid)
                if cid in CLUSTER_PROFILES.get(algo, {}):
                    CLUSTER_PROFILES[algo][cid] = {f: float(row[f]) for f in PLAYLIST_FEATURES}
        print("✅  Cluster profiles recomputed from data (models ↔ profiles in sync)")
    except Exception as _prof_err:
        print(f"⚠️   Cluster profile recompute skipped: {_prof_err}")


try:
    _load_playlist_data()
    _build_cluster_profiles()
except Exception as _playlist_err:
    print(f"⚠️   Playlist dataset failed to load: {_playlist_err}")


def _youtube_enabled() -> bool:
    return bool(YOUTUBE_API_KEY)


def _clip(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return float(np.clip(v, lo, hi))


def _youtube_get(endpoint: str, params: dict = None) -> dict:
    if not _youtube_enabled():
        raise HTTPException(status_code=503, detail="YouTube integration is not configured on the backend (set YOUTUBE_API_KEY).")

    query = dict(params or {})
    query["key"] = YOUTUBE_API_KEY
    resp = requests.get(f"{YOUTUBE_BASE}/{endpoint}", params=query, timeout=12)
    if resp.status_code != 200:
        # 400/403 usually mean an invalid key, disabled API, or exhausted quota
        raise HTTPException(status_code=503, detail=f"YouTube API error: {resp.text[:220]}")
    return resp.json()


_ISO8601_DURATION_RE = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def _parse_iso8601_duration(value: str) -> float:
    """Parse ISO 8601 durations like 'PT3M32S' / 'PT1H2M3S' into seconds."""
    match = _ISO8601_DURATION_RE.match((value or "").strip())
    if not match:
        return 210.0
    days, hours, minutes, seconds = [float(x or 0) for x in match.groups()]
    return days * 86400.0 + hours * 3600.0 + minutes * 60.0 + seconds


def _youtube_videos(video_ids: list) -> list:
    """Fetch full video details (snippet + contentDetails + statistics) by id."""
    ids = [x for x in video_ids if x]
    if not ids:
        return []

    try:
        payload = _youtube_get("videos", params={
            "part": "snippet,contentDetails,statistics",
            "id": ",".join(ids[:50]),
        })
        return payload.get("items", []) or []
    except HTTPException:
        return []


def _youtube_search_items(query: str, limit: int = 8) -> list:
    """Search YouTube Music videos and enrich with duration/engagement stats."""
    payload = _youtube_get("search", params={
        "part": "snippet",
        "q": query,
        "type": "video",
        "videoCategoryId": "10",          # Music
        "maxResults": max(1, min(limit, 20)),
        "safeSearch": "none",
        "relevanceLanguage": "en",
    })
    search_items = payload.get("items", []) or []
    ids = [(it.get("id") or {}).get("videoId") for it in search_items]
    details = {v.get("id"): v for v in _youtube_videos(ids)}

    items = []
    for it in search_items:
        video_id = (it.get("id") or {}).get("videoId")
        if not video_id:
            continue
        snip = it.get("snippet") or {}
        det = details.get(video_id) or {}
        stats = det.get("statistics") or {}
        content = det.get("contentDetails") or {}
        items.append({
            "id": video_id,
            "name": snip.get("title", "Unknown video"),
            "artists": snip.get("channelTitle", ""),
            "album": "",
            "duration_seconds": int(_parse_iso8601_duration(content.get("duration"))),
            "view_count": int(stats.get("viewCount", 0) or 0),
            "like_count": int(stats.get("likeCount", 0) or 0),
            "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
        })
    return items


def _dataset_match_features(video: dict) -> tuple:
    """Match a YouTube video against the project dataset (80k songs with real
    audio features). Returns (feature_dict, match_meta) or (None, None).

    Matching runs on normalized titles ('Song (Official Video)' → 'song') plus
    two artist-corroboration signals: channel name ≈ dataset artist, and the
    pre-dash artist segment of the video title.

    Acceptance requires verification (channel or title-hint matches the dataset
    artist) or — with NO artist signal at all — an exact, distinctive, unique
    title. Title-only hits with a CONFLICTING artist are rejected outright:
    'Billie Eilish - TV' used to match Armani White's track 'BILLIE EILISH.'
    and inherit its upbeat features. Rejections come back as
    {'status': 'rejected', 'reason', 'closest_track', 'closest_artist'} so the
    API can honestly tell the user the song wasn't (or couldn't be) matched.
    """
    df = _playlist.get("df")
    index = _playlist.get("title_index") or {}
    if df is None or not index:
        return None, None

    snip = video.get("snippet") or {}
    title = snip.get("title", "")
    channel_n = _norm_match_text(snip.get("channelTitle", ""))
    # Two independent artist signals: the video's channel, and the pre-dash
    # artist segment of its title ('Billie Eilish - TV' → hint 'billie eilish').
    artist_hint, _ = _split_yt_title(title)
    variants = _title_variants(title)

    def _corroboration(artist_n) -> float:
        """0 = no artist evidence; 1.5/2.0 = dataset artist verified."""
        if not artist_n:
            return 0.0
        best = _artist_bonus(artist_n, channel_n)
        if artist_hint:
            best = max(best, _artist_bonus(artist_n, artist_hint))
        return best

    def _accept(ratio: float, corrob: float, exact: bool, variant: str) -> bool:
        # Rule 1 — artist verified by channel or in-title artist hint:
        # accept, with a stricter similarity bar when only partially verified.
        if corrob >= 2.0:
            return ratio >= 0.55
        if corrob >= 1.5:
            return ratio >= 0.75
        # Rule 2 — the video NAMES an artist and the dataset row is someone
        # else → wrong song (the 'Billie Eilish - TV' vs 'BILLIE EILISH.' bug).
        if artist_hint:
            return False
        # Rule 3 — no artist signal anywhere (no hint, channel unrelated):
        # only an EXACT, distinctive, UNIQUE title qualifies. Anything weaker
        # would be guessing between same-titled songs, so we decline instead.
        distinctive = len(variant.split()) >= 3 or len(variant) >= 12
        unique = len(index.get(variant, ())) == 1
        return exact and ratio >= 0.99 and distinctive and unique

    candidates = []  # dicts: score/tier first, acceptance decided per candidate

    def consider(pos, artist_n, variant, ratio, exact):
        corrob = _corroboration(artist_n)
        candidates.append({
            "score": (2.0 if exact else 0.0) + corrob + ratio,
            "tier": 1 if corrob >= 1.5 else 0,   # verified beats unverified
            "pos": pos,
            "variant": variant,
            "ratio": ratio,
            "corrob": corrob,
            "exact": exact,
            "match_type": "title+artist" if corrob >= 2.0 else "title",
            "accepted": _accept(ratio, corrob, exact, variant),
        })

    # 1) exact normalized-title hits (fast path)
    for v in variants:
        for pos, artist_n in index.get(v, ()):
            consider(pos, artist_n, v, 1.0, True)

    # 2) containment / fuzzy over index keys — runs even when exact hits exist,
    #    so a corroborated fuzzy candidate can outrank a wrong exact one
    for v in variants:
        if len(v) < 6:
            continue
        for key, rows in index.items():
            if len(key) < 6 or (key not in v and v not in key):
                continue
            ratio = SequenceMatcher(None, key, v).ratio()
            for pos, artist_n in rows:
                consider(pos, artist_n, key, ratio, False)

    if not candidates:
        return None, None

    accepted = [c for c in candidates if c["accepted"]]
    if not accepted:
        # Honest rejection: remember the closest attempt so the caller can tell
        # the user a similar title exists but was NOT used (or wasn't found).
        best = max(candidates, key=lambda c: c["score"])
        row = df.iloc[best["pos"]]
        return None, {
            "status": "rejected",
            "reason": "artist_mismatch" if (artist_hint and best["corrob"] == 0.0) else "unverified",
            "closest_track": str(row["track_name"]),
            "closest_artist": str(row["artists"]).replace(";", ", "),
        }

    # Artist-verified candidates always outrank unverified ones; within a tier,
    # exact beats fuzzy and higher corroboration/similarity wins.
    best = max(accepted, key=lambda c: (c["tier"], c["score"]))
    pos, ratio, match_type = best["pos"], best["ratio"], best["match_type"]

    row = df.iloc[pos]
    has_vocals = row.get("has_vocals")
    has_vocals = 1.0 if pd.isna(has_vocals) else float(has_vocals)
    energy = float(row["energy"])
    digest = hashlib.sha256(str(row["track_name"]).encode("utf-8", errors="ignore")).digest()

    feats = {
        "energy": _clip(float(row["energy"])),
        "valence": _clip(float(row["valence"])),
        "danceability": _clip(float(row["danceability"])),
        "acousticness": _clip(float(np.expm1(float(row["acousticness_log"])))),
        "liveness": _clip(float(np.expm1(float(row["liveness_log"])))),
        "speechiness": 0.05,
        "instrumentalness": 0.05 if has_vocals >= 0.5 else 0.65,
        "tempo": float(np.clip(30.0 + float(row["tempo_norm"]) * 220.0, 40.0, 220.0)),
        "loudness": round(-18.0 + 12.0 * _clip(energy), 1),
        "key": digest[3] % 12,
        "mode": 1 if digest[4] % 2 else 0,
    }
    meta = {
        "status": "matched",
        "matched_track": str(row["track_name"]),
        "matched_artist": str(row["artists"]).replace(";", ", "),
        "match_type": match_type,
        "match_ratio": round(float(ratio), 3),
        "match_confidence": "artist_verified" if best["tier"] else "title_only",
    }
    # Exact engineered vector the models were trained on (bypasses re-derivation)
    feats["feature_vector"] = [float(row[c]) for c in PLAYLIST_FEATURES]
    return feats, meta


# ─────────────────────────────────────────────────────────────────────────────
# Metadata feature estimation (fallback when the song is NOT in the dataset)
#
# YouTube's Data API exposes no audio features, so mood features are estimated
# from title/channel keyword banks (genre & mood words), popularity, engagement,
# duration and era — plus a deterministic per-video hash prior that reflects the
# honest fact that metadata underdetermines how a song actually sounds.
# ─────────────────────────────────────────────────────────────────────────────
_HEURISTIC_BANKS = [
    # (label, keywords, shifts applied to the feature estimate when matched)
    ("acoustic", ["acoustic", "piano", "classical", "orchestra", "orchestral", "symphony", "sonata",
                  "violin", "cello", "opera", "choir", "harp", "flute", "unplugged", "instrumental",
                  "folk", "lullaby"],
     {"acoustic": 0.48, "energy": -0.18, "instr": 0.22, "tempo": -10, "valence": -0.03}),
    ("live", ["live", "concert", "session", "festival", "tour", "arena", "stadium", "encore"],
     {"live": 0.42, "energy": 0.06, "tempo": 4}),
    ("metal", ["metal", "metalcore", "hardcore", "thrash", "deathcore", "heavy"],
     {"energy": 0.34, "valence": -0.10, "acoustic": -0.12, "dance": 0.04}),
    ("electronic", ["edm", "techno", "trance", "dubstep", "electro", "electronic", "house",
                    "dnb", "drum and bass", "bass boosted", "dj"],
     {"energy": 0.26, "dance": 0.22, "acoustic": -0.14}),
    ("rock", ["rock", "punk", "grunge", "indie", "alternative"],
     {"energy": 0.17, "dance": 0.04, "valence": -0.02}),
    ("pop_party", ["pop", "k pop", "disco", "funk", "party", "club", "summer", "dance", "chart"],
     {"valence": 0.18, "dance": 0.18, "energy": 0.10}),
    ("sad", ["sad", "heartbreak", "breakup", "cry", "crying", "tears", "lonely", "melancholy",
             "melancholic", "blues", "grief", "depressed", "winter", "rain", "goodbye", "farewell",
             "emo", "pain"],
     {"valence": -0.36, "energy": -0.18, "acoustic": 0.14, "tempo": -8}),
    ("happy", ["happy", "sunshine", "sunny", "joyful", "smile", "laugh", "funny", "upbeat",
               "celebrate", "celebration"],
     {"valence": 0.34, "energy": 0.10, "dance": 0.06}),
    ("chill", ["lofi", "lo fi", "chill", "relax", "relaxing", "sleep", "study", "ambient",
               "meditation", "meditate", "calm", "peaceful", "spa", "white noise"],
     {"energy": -0.38, "dance": -0.16, "acoustic": 0.18, "tempo": -16, "valence": 0.04}),
    ("rap", ["rap", "hip hop", "drill", "trap", "freestyle"],
     {"speech": 0.03, "dance": 0.12, "acoustic": -0.12, "energy": 0.08, "valence": -0.05}),
    ("dark", ["dark", "night", "devil", "witch", "horror", "gothic", "doom", "funeral", "blood",
              "ghost", "evil", "shadow"],
     {"valence": -0.28, "energy": 0.06, "instr": 0.05}),
    ("romance", ["love", "lover", "loving", "baby", "kiss", "romantic", "sweetheart", "honey"],
     {"valence": 0.20, "energy": -0.06}),
    ("hype", ["workout", "gym", "motivational", "hype", "training", "beastmode"],
     {"energy": 0.26, "dance": 0.08, "valence": 0.06}),
]


def _bank_shifts(norm_text: str) -> dict:
    """Accumulate weighted keyword-bank shifts from a normalized title+channel.
    Word-boundary matching (tokens / phrases) — no substring false hits like
    'live' inside 'alive' or 'mix' inside 'remix'."""
    tokens = set(norm_text.split())
    padded = f" {norm_text} "
    H = {"energy": 0.0, "valence": 0.0, "dance": 0.0, "acoustic": 0.0,
         "live": 0.0, "speech": 0.0, "instr": 0.0, "tempo": 0.0}
    for _, words, shifts in _HEURISTIC_BANKS:
        hit = False
        for w in words:
            if " " in w:
                if f" {w} " in padded:
                    hit = True
            elif w in tokens:
                hit = True
            if hit:
                break
        if hit:
            for k, v in shifts.items():
                H[k] += v
    # Cap cumulative stacking so many hits in one direction can't dominate
    return {k: float(np.clip(v, -0.5, 0.5)) for k, v in H.items()}


def _hash_prior(video_id: str, salt: str, span: float) -> float:
    """Deterministic per-video prior in [-span, +span]."""
    digest = hashlib.sha256(f"{video_id or ''}|{salt}".encode("utf-8", errors="ignore")).digest()
    unit = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    return (unit - 0.5) * 2.0 * span


def _estimate_features_from_video(video: dict, video_id: str) -> dict:
    """Heuristic feature estimation from YouTube metadata (song not in dataset).

    Signals used: title/channel keyword banks (genre & mood words), popularity
    (log-scaled views), engagement (likes/views), duration and release era.
    Keyword banks carry most of the mood signal; popularity is deliberately
    only a weak term — otherwise every popular video collapses onto the same
    features. A per-video hash prior adds honest, stable variance.
    """
    snip    = video.get("snippet") or {}
    stats   = video.get("statistics") or {}
    content = video.get("contentDetails") or {}

    views = float(stats.get("viewCount", 0) or 0)
    likes = float(stats.get("likeCount", 0) or 0)

    popularity = _clip((np.log10(views + 1.0) - 2.0) / 6.0)   # 100 views ~ 0, 100M+ ~ 1
    like_ratio = _clip(likes / views) if views > 0 else 0.0
    engagement = _clip(like_ratio / 0.06)                     # ~6% likes/views = very good

    duration_s   = float(_parse_iso8601_duration(content.get("duration")))
    duration_norm = _clip((duration_s - 120.0) / 240.0)
    longform     = _clip((duration_s - 300.0) / 600.0)        # >10 min → 1.0

    published = str(snip.get("publishedAt") or "")
    release_year = int(published[:4]) if len(published) >= 4 and published[:4].isdigit() else 2015
    era_norm = _clip((release_year - 1980.0) / 45.0)

    title   = str(snip.get("title") or "")
    channel = str(snip.get("channelTitle") or "")
    title_blob = _norm_match_text(f"{title} {channel}")

    H = _bank_shifts(title_blob)

    # Centered terms (−0.5 … +0.5) — popularity must never dominate, or every
    # popular music video lands on identical features.
    pop_c = popularity - 0.5
    eng_c = engagement - 0.5
    era_c = era_norm - 0.5

    energy = _clip(
        0.52 + (0.18 * pop_c) + (0.08 * eng_c) + (0.06 * era_c)
        + H["energy"] + _hash_prior(video_id, "energy", 0.16)
    )
    valence = _clip(
        0.50 + (0.12 * pop_c) + (0.10 * eng_c) + (0.05 * era_c)
        + H["valence"] + _hash_prior(video_id, "valence", 0.18)
    )
    danceability = _clip(
        0.48 + (0.18 * pop_c) + (0.10 * eng_c) + (0.06 * era_c)
        + H["dance"] + _hash_prior(video_id, "dance", 0.14)
    )
    acousticness = _clip(
        0.30 - (0.16 * pop_c) + (0.10 * longform)
        + H["acoustic"] + _hash_prior(video_id, "acoustic", 0.18)
    )
    liveness = _clip(
        0.10 + (0.06 * longform) + H["live"] + _hash_prior(video_id, "live", 0.07)
    )
    speechiness = _clip(0.05 + H["speech"] + _hash_prior(video_id, "speech", 0.03))
    instrumentalness = _clip(0.05 + H["instr"] + _hash_prior(video_id, "instr", 0.08))
    tempo = float(np.clip(
        110.0 + (30.0 * pop_c) + H["tempo"] + _hash_prior(video_id, "tempo", 18.0),
        55.0, 195.0,
    ))

    return {
        "energy": energy,
        "valence": valence,
        "danceability": danceability,
        "acousticness": acousticness,
        "liveness": liveness,
        "speechiness": speechiness,
        "instrumentalness": instrumentalness,
        "tempo": tempo,
        "loudness": round(-18.0 + 12.0 * energy, 1),
        "key": (hashlib.sha256((video_id or title).encode("utf-8", errors="ignore")).digest()[3] % 12),
        "mode": 1,
    }


def _youtube_video_payload(video_id: str) -> dict:
    videos = _youtube_videos([video_id])
    if not videos:
        raise HTTPException(status_code=404, detail="YouTube video not found.")

    video = videos[0]
    snip  = video.get("snippet") or {}

    payload = {
        "song_name": snip.get("title", "Unknown Song"),
        "artist_name": snip.get("channelTitle", ""),
        "youtube_video_id": video_id,
        "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
        "embed_url": f"https://www.youtube-nocookie.com/embed/{video_id}",
    }

    matched_feats, match_meta = _dataset_match_features(video)
    if matched_feats:
        payload.update(matched_feats)
        payload.update({
            "feature_source": "dataset_match",
            "feature_note": (
                f"Found in the project dataset: “{match_meta['matched_track']}” by "
                f"{match_meta['matched_artist']} — using its real audio features."
                if match_meta.get("match_type") == "title+artist" else
                f"Exact title match in the dataset: “{match_meta['matched_track']}” by "
                f"{match_meta['matched_artist']} (artist not confirmed from the video, but the "
                f"title is unique in the dataset) — using its audio features."
            ),
            "dataset_match": match_meta,
        })
    else:
        payload.update(_estimate_features_from_video(video, video_id))
        base_note = (
            "YouTube's Data API provides no audio features. This song was not found in the "
            "project dataset, so mood features are estimated from video metadata (title, "
            "channel, views, likes, duration) — treat mood and confidence as approximate."
        )
        if match_meta and match_meta.get("status") == "rejected" \
                and match_meta.get("reason") == "artist_mismatch":
            base_note = (
                f"A similar title exists in the dataset — “{match_meta['closest_track']}” by "
                f"{match_meta['closest_artist']} — but it is a different artist from this video, "
                f"so it was NOT used. Mood features are estimated from video metadata "
                f"instead — treat mood and confidence as approximate."
            )
        payload.update({
            "feature_source": "youtube_metadata_heuristic",
            "feature_note": base_note,
        })
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# Feature engineering (mirrors Phase 3 of notebook exactly)
# ─────────────────────────────────────────────────────────────────────────────
def engineer_features(raw: dict) -> np.ndarray:
    """
    Convert raw track features into augmented feature vector.
    Matches the exact transformations in Phase 3 of the notebook:
    augmented = [mood_ev, mood_groove, mood_dark,
                 acousticness_log, liveness_log]
    (speechiness_capped is reported for display only — the trained
    scaler/models expect exactly the 5 features above.)
    """
    energy   = float(raw.get("energy",           0.5))
    valence  = float(raw.get("valence",           0.5))
    dance    = float(raw.get("danceability",      0.5))
    acoustic = float(raw.get("acousticness",      0.3))
    live     = float(raw.get("liveness",          0.15))
    speech   = float(raw.get("speechiness",       0.05))
    instrm   = float(raw.get("instrumentalness",  0.05))
    tempo    = float(raw.get("tempo",             120.0))

    # Phase 3 transforms
    acoustic_log  = np.log1p(acoustic)
    liveness_log  = np.log1p(live)
    speech_capped = min(speech, 0.33)
    has_vocals    = 1.0 if instrm < 0.5 else 0.0
    tempo_norm    = (tempo - 30.0) / (250.0 - 30.0)
    tempo_norm    = float(np.clip(tempo_norm, 0.0, 1.0))

    # Composite scores
    mood_ev = (energy + valence) / 2.0

    raw_dark   = (1.0 - valence) * acoustic_log * (1.0 - energy)
    mood_dark  = float(np.clip(raw_dark / 0.45, 0.0, 1.0))   # approximate max from training

    raw_groove  = dance * tempo_norm * has_vocals
    mood_groove = float(np.clip(raw_groove / 0.60, 0.0, 1.0))  # approximate max from training

    # Order matches the trained augmented feature list (5 features):
    # mood_ev, mood_groove, mood_dark, acousticness_log, liveness_log
    X = np.array([[mood_ev, mood_groove, mood_dark,
                   acoustic_log, liveness_log]])

    return X, {
        "mood_ev":            round(mood_ev,       4),
        "mood_groove":        round(mood_groove,    4),
        "mood_dark":          round(mood_dark,      4),
        "acousticness_log":   round(acoustic_log,   4),
        "liveness_log":       round(liveness_log,   4),
        "speechiness_capped": round(speech_capped,  4),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Demo predictor (when models are not loaded)
# ─────────────────────────────────────────────────────────────────────────────
def demo_predict(fv: dict) -> dict:
    """Rule-based prediction mirroring cluster definitions from Phase 4."""
    mev   = fv["mood_ev"]
    mdark = fv["mood_dark"]
    mgrv  = fv["mood_groove"]
    alog  = fv["acousticness_log"]

    # K-Means assignment (rules mirror Phase-4 cluster definitions; output
    # labels follow the pickled model's numbering — see cluster-definition note)
    if mdark > 0.45 and alog > 0.4:
        km = 0        # Melancholic / Acoustic
    elif mev > 0.62 and mgrv > 0.25:
        km = 1        # High Energy / Mainstream
    elif mev > 0.60:
        km = 2        # Energetic / Upbeat
    else:
        km = 3        # Indie / Mid-Tempo

    # HDBSCAN assignment
    if mdark > 0.50 and alog > 0.45:
        hdb = 0       # Melancholic / Acoustic
    elif mdark > 0.25 and alog > 0.35:
        hdb = 2       # Bittersweet / Acoustic
    elif mev > 0.60 and mgrv < 0.05:
        hdb = 1       # Cinematic / Electronic
    elif mev > 0.60:
        hdb = 3       # High Energy / Mainstream
    else:
        hdb = -1

    # GMM probabilities (soft)
    proba = [0.05, 0.05, 0.05, 0.05]
    if mdark > 0.45 and alog > 0.4:
        proba[1] = 0.80; proba[3] = 0.10   # 1 = Melancholic / Acoustic
    elif mev > 0.62 and mgrv > 0.25:
        proba[0] = 0.80; proba[3] = 0.10   # 0 = High Energy / Mainstream
    elif mev > 0.60:
        proba[2] = 0.75; proba[3] = 0.10   # 2 = Live / Electronic
    else:
        proba[3] = 0.75; proba[1] = 0.10   # 3 = Introspective / Indie
    total = sum(proba)
    proba = [round(p / total, 4) for p in proba]
    gmm_label = int(np.argmax(proba))

    return {
        "kmeans":  {"label": km,        "confidence": 0.87},
        "hdbscan": {"label": hdb,       "is_noise": hdb == -1, "confidence": 0.78},
        "gmm":     {"label": gmm_label, "probabilities": proba, "max_confidence": max(proba)},
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────────────────────────────────────
class SongInput(BaseModel):
    song_name:        Optional[str]   = "Unknown Song"
    artist_name:      Optional[str]   = ""
    energy:           float = 0.65
    valence:          float = 0.55
    danceability:     float = 0.60
    acousticness:     float = 0.20
    liveness:         float = 0.15
    speechiness:      float = 0.05
    instrumentalness: float = 0.05
    tempo:            float = 120.0
    loudness:         float = -7.0
    key:              Optional[int]   = 5
    mode:             Optional[int]   = 1
    # Optional precomputed engineered vector [mood_ev, mood_groove, mood_dark,
    # acousticness_log, liveness_log] — set for dataset-matched songs so the
    # models see exactly the values they were trained on.
    feature_vector:   Optional[list]  = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"message": "Music Mood Clustering API", "version": "2.0.0", "demo_mode": DEMO_MODE}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "demo_mode": DEMO_MODE,
        "models_loaded": list(models.keys()),
        "model_dir": MODEL_DIR,
        "youtube_enabled": _youtube_enabled(),
    }


@app.get("/youtube/search")
def youtube_search(q: str, limit: int = 8):
    query = (q or "").strip()
    if len(query) < 2:
        return {"items": []}

    return {"items": _youtube_search_items(query, max(1, min(limit, 20)))}


@app.get("/youtube/track-info/{video_id}")
def youtube_track_info(video_id: str):
    return _youtube_video_payload(video_id)


@app.post("/analyze-video/{video_id}")
def analyze_video(video_id: str):
    payload = _youtube_video_payload(video_id)
    allowed_fields = set(getattr(SongInput, "model_fields", {}).keys() or getattr(SongInput, "__fields__", {}).keys())
    song_input = SongInput(**{k: payload[k] for k in allowed_fields if k in payload})
    result = analyze(song_input)
    result["youtube_video_id"] = payload.get("youtube_video_id")
    result["youtube_url"] = payload.get("youtube_url")
    result["embed_url"] = payload.get("embed_url")
    result["feature_source"] = payload.get("feature_source", "unknown")
    result["feature_note"] = payload.get("feature_note")
    result["dataset_match"] = payload.get("dataset_match")
    if payload.get("feature_source") == "youtube_metadata_heuristic":
        _temper_estimated_confidence(result)
    return result


def _temper_estimated_confidence(result: dict, mix: float = 0.35) -> dict:
    """When features are metadata ESTIMATES (not real audio features), the GMM's
    near-1.0 probabilities overstate certainty. Blend them toward the uniform
    distribution so the UI never claims ~100% confidence on a guess.
    Blending with a constant preserves the ranking, so the winner stays put."""
    gmm = (result.get("algorithms") or {}).get("gmm")
    probs = gmm.get("probabilities") if gmm else None
    if not probs:
        return result

    uniform = 1.0 / len(probs)
    tempered = [{**p, "probability": round((1.0 - mix) * float(p.get("probability", 0.0)) + mix * uniform, 4)}
                for p in probs]
    tempered.sort(key=lambda p: p["probability"], reverse=True)
    gmm["probabilities"] = tempered
    if tempered:
        gmm["confidence"] = round(tempered[0]["probability"], 4)
    gmm["confidence_estimated"] = True

    for algo, cap in (("kmeans", 0.75), ("hdbscan", 0.70)):
        entry = (result.get("algorithms") or {}).get(algo)
        if entry and isinstance(entry.get("confidence"), (int, float)):
            entry["confidence"] = round(min(float(entry["confidence"]), cap), 4)
            entry["confidence_estimated"] = True

    result["confidence_note"] = (
        f"Features estimated from YouTube metadata — probabilities rounded toward "
        f"uncertainty (max ≈ {round((1.0 - mix + mix * uniform) * 100)}%)."
    )
    return result


@app.post("/analyze")
def analyze(song: SongInput):
    """
    Main endpoint. Takes song audio features, returns:
    - Mood prediction from all 3 algorithms
    - Winner (GMM - best Davies-Bouldin)
    - Cluster profiles for chart rendering
    - Soft probabilities (GMM only)
    - Song recommendations
    """
    raw = song.dict()
    fv_override = raw.pop("feature_vector", None)
    if isinstance(fv_override, (list, tuple)) and len(fv_override) == 5:
        # Dataset-matched song: use the exact engineered vector the models were
        # trained on (the app's re-derivation normalizes mood_dark/mood_groove
        # slightly differently than the notebook, which would shift the cluster).
        X = np.array([[float(v) for v in fv_override]], dtype=float)
        feature_vector = {
            "mood_ev":          round(float(X[0][0]), 4),
            "mood_groove":      round(float(X[0][1]), 4),
            "mood_dark":        round(float(X[0][2]), 4),
            "acousticness_log": round(float(X[0][3]), 4),
            "liveness_log":     round(float(X[0][4]), 4),
            "speechiness_capped": round(min(float(raw.get("speechiness", 0.05) or 0.05), 0.33), 4),
        }
    else:
        X, feature_vector = engineer_features(raw)

    # Get predictions
    if DEMO_MODE:
        preds = demo_predict(feature_vector)
    else:
        try:
            X_scaled = scalers["aug"].transform(X)

            # K-Means (hard assignment)
            km_label = int(models["kmeans"].predict(X_scaled)[0])

            # HDBSCAN (density — may return -1 for noise)
            # NOTE: use the module-level function — newer hdbscan versions no
            # longer expose `approximate_predict` as a bound method, and
            # refitting via fit_predict would destroy the trained clusterer.
            try:
                from hdbscan.prediction import approximate_predict as _hdb_approx_predict
                hdb_labels, _ = _hdb_approx_predict(models["hdbscan"], X_scaled)
                hdb_label = int(hdb_labels[0])
            except Exception:
                # Honest fallback: treat as noise rather than refitting the model
                hdb_label = -1

            # GMM (soft probabilities)
            gmm_proba = models["gmm"].predict_proba(X_scaled)[0].tolist()
            gmm_label = int(np.argmax(gmm_proba))

            preds = {
                "kmeans":  {"label": km_label,  "confidence": 1.0},
                "hdbscan": {"label": hdb_label, "is_noise": hdb_label == -1, "confidence": 0.85},
                "gmm":     {"label": gmm_label, "probabilities": gmm_proba, "max_confidence": float(max(gmm_proba))},
            }
        except Exception as e:
            print(f"Prediction error: {e} — falling back to demo")
            preds = demo_predict(feature_vector)

    # Build full algorithm results
    km_info  = KMEANS_CLUSTERS[preds["kmeans"]["label"]]
    hdb_info = HDBSCAN_CLUSTERS.get(preds["hdbscan"]["label"], HDBSCAN_CLUSTERS[-1])
    gmm_info = GMM_CLUSTERS[preds["gmm"]["label"]]

    # GMM is the winner (best Davies-Bouldin)
    winner_mood = gmm_info["name"]

    # Format GMM probabilities for frontend
    gmm_probs_raw = preds["gmm"]["probabilities"]
    gmm_prob_list = [
        {
            "cluster_id":   i,
            "cluster_name": GMM_CLUSTERS[i]["name"],
            "probability":  round(gmm_probs_raw[i], 4),
            "color":        GMM_CLUSTERS[i]["color"],
            "emoji":        GMM_CLUSTERS[i]["emoji"],
        }
        for i in range(4)
    ]
    gmm_prob_list.sort(key=lambda x: x["probability"], reverse=True)

    return {
        "song_name":    raw.get("song_name", "Unknown Song"),
        "artist_name":  raw.get("artist_name", ""),
        "demo_mode":    DEMO_MODE,

        # Winner
        "winner":       "gmm",
        "winner_label": "GMM (Gaussian Mixture Model)",
        "winner_mood":  winner_mood,
        "winner_color": gmm_info["color"],
        "winner_emoji": gmm_info["emoji"],
        "winner_description": gmm_info["description"],
        "winner_reason": "GMM wins on Davies-Bouldin (0.8878) — the most neutral metric. No asterisks, no circular reasoning. Only algorithm with soft probabilities.",

        # Engineered features (for frontend display)
        "feature_vector": feature_vector,

        # Algorithm results (for comparison charts)
        "algorithms": {
            "kmeans": {
                "id":           "kmeans",
                "name":         "K-Means",
                "subtitle":     "k = 4  ·  k-means++  ·  n_init = 20",
                "label":        preds["kmeans"]["label"],
                "cluster_name": km_info["name"],
                "cluster_description": km_info["description"],
                "color":        km_info["color"],
                "emoji":        km_info["emoji"],
                "confidence":   round(preds["kmeans"]["confidence"], 4),
                "is_winner":    False,
                "is_noise":     False,
                "metrics":      ALGORITHM_METRICS["kmeans"],
                "cluster_profile": CLUSTER_PROFILES["kmeans"][preds["kmeans"]["label"]],
                "all_cluster_profiles": CLUSTER_PROFILES["kmeans"],
                "cluster_names": {k: v["name"] for k, v in KMEANS_CLUSTERS.items()},
                "cluster_colors": {k: v["color"] for k, v in KMEANS_CLUSTERS.items()},
            },
            "hdbscan": {
                "id":           "hdbscan",
                "name":         "HDBSCAN",
                "subtitle":     "min_cluster_size = 750  ·  min_samples = 10",
                "label":        preds["hdbscan"]["label"],
                "cluster_name": hdb_info["name"],
                "cluster_description": hdb_info["description"],
                "color":        hdb_info["color"],
                "emoji":        hdb_info["emoji"],
                "confidence":   round(preds["hdbscan"].get("confidence", 0.78), 4),
                "is_winner":    False,
                "is_noise":     preds["hdbscan"].get("is_noise", False),
                "metrics":      ALGORITHM_METRICS["hdbscan"],
                "cluster_profile": CLUSTER_PROFILES["hdbscan"].get(preds["hdbscan"]["label"],
                                                                    CLUSTER_PROFILES["hdbscan"][0]),
                "all_cluster_profiles": {k: v for k, v in CLUSTER_PROFILES["hdbscan"].items() if k != -1},
                "cluster_names": {k: v["name"] for k, v in HDBSCAN_CLUSTERS.items() if k != -1},
                "cluster_colors": {k: v["color"] for k, v in HDBSCAN_CLUSTERS.items() if k != -1},
            },
            "gmm": {
                "id":           "gmm",
                "name":         "GMM",
                "subtitle":     "covariance = spherical  ·  k = 4",
                "label":        preds["gmm"]["label"],
                "cluster_name": gmm_info["name"],
                "cluster_description": gmm_info["description"],
                "color":        gmm_info["color"],
                "emoji":        gmm_info["emoji"],
                "confidence":   round(preds["gmm"]["max_confidence"], 4),
                "is_winner":    True,
                "is_noise":     False,
                "probabilities": gmm_prob_list,
                "metrics":      ALGORITHM_METRICS["gmm"],
                "cluster_profile": CLUSTER_PROFILES["gmm"][preds["gmm"]["label"]],
                "all_cluster_profiles": CLUSTER_PROFILES["gmm"],
                "cluster_names": {k: v["name"] for k, v in GMM_CLUSTERS.items()},
                "cluster_colors": {k: v["color"] for k, v in GMM_CLUSTERS.items()},
            },
        },

        # Recommendations based on winner mood
        "recommendations": get_recommendations(winner_mood),
    }


@app.get("/algorithm-comparison")
def algorithm_comparison():
    """Returns the algorithm comparison table data for the overview page."""
    return {
        "algorithms": [
            {
                "name": "K-Means",
                "params": "k=4, k-means++",
                "silhouette": 0.3426, "davies_bouldin": 1.0252, "calinski_harabasz": 79060,
                "is_winner": False, "color": "#4A90D9",
                "best_metric": "Calinski-Harabasz",
                "note": None,
                "n_clusters": 4, "noise_pct": 0,
            },
            {
                "name": "HDBSCAN",
                "params": "mcs=750, min_samples=10",
                "silhouette": 0.3937, "davies_bouldin": 1.0058, "calinski_harabasz": 57801,
                "is_winner": False, "color": "#E07B54",
                "best_metric": "Silhouette (with asterisk)",
                "note": "Silhouette on 42.6% non-noise points only",
                "n_clusters": 4, "noise_pct": 57.4,
            },
            {
                "name": "GMM (spherical)",
                "params": "k=4, spherical covariance",
                "silhouette": 0.3867, "davies_bouldin": 0.8878, "calinski_harabasz": 76641,
                "is_winner": True, "color": "#8B6BB1",
                "best_metric": "Davies-Bouldin",
                "note": None,
                "n_clusters": 4, "noise_pct": 0,
            },
        ],
        "winner": "GMM (spherical)",
        "winner_reason": "Best Davies-Bouldin (0.8878) — most neutral metric. No asterisks. Only algorithm with soft probability assignments.",
        "dbscan_note": "DBSCAN was attempted but failed due to Spotify's feature discretisation (27% near-duplicate rows). Documented as a data characteristic finding.",
    }


@app.get("/cluster-overview")
def cluster_overview():
    """Returns all cluster definitions for the overview/explore page."""
    return {
        "kmeans":  [{"id": k, **v, "profile": CLUSTER_PROFILES["kmeans"][k]}  for k, v in KMEANS_CLUSTERS.items()],
        "hdbscan": [{"id": k, **v, "profile": CLUSTER_PROFILES["hdbscan"][k]} for k, v in HDBSCAN_CLUSTERS.items() if k != -1],
        "gmm":     [{"id": k, **v, "profile": CLUSTER_PROFILES["gmm"][k]}     for k, v in GMM_CLUSTERS.items()],
    }


@app.get("/recommendations/{mood}")
def recommendations_by_mood(mood: str):
    """Get recommendations for a given mood name."""
    recs = get_recommendations(mood)
    return {"mood": mood, "count": len(recs), "recommendations": recs}


@app.get("/moods")
def moods():
    """The four MoodMatch moods with their KMeans cluster mapping and counts."""
    df = _playlist["df"]
    items = []
    for key, meta in MOOD_QUADRANTS.items():
        cluster = _playlist["mood_to_cluster"].get(key)
        count = 0
        cluster_mean = None
        if df is not None and cluster is not None:
            subset = df[df["cluster"] == cluster]
            count = int(len(subset))
            if count:
                cluster_mean = {
                    "valence": round(float(subset["valence"].mean()), 3),
                    "energy": round(float(subset["energy"].mean()), 3),
                }
        items.append({
            "key": key,
            "emoji": meta["emoji"],
            "name": meta["name"],
            "description": meta["description"],
            "cluster_id": int(cluster) if cluster is not None else None,
            "song_count": count,
            "cluster_mean": cluster_mean,
        })
    return {"moods": items, "source": _playlist["source"]}


@app.get("/playlist")
def playlist(mood: str = "happy", limit: int = 20):
    """MoodMatch core endpoint: GET /playlist?mood=happy → a random sample of
    ~15-20 songs from the dataset cluster labeled for that mood."""
    key = MOOD_ALIASES.get((mood or "").strip().lower())
    if key is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown mood '{mood}'. Valid options: {', '.join(MOOD_QUADRANTS)} "
                   f"(aliases: upbeat/party, melancholy/blue, intense/metal, chill/mellow).",
        )

    df = _playlist["df"]
    if df is None:
        raise HTTPException(status_code=503, detail="Playlist dataset is unavailable on the backend.")

    cluster = _playlist["mood_to_cluster"].get(key)
    subset = df[df["cluster"] == cluster]
    if len(subset) < PLAYLIST_MIN:
        subset = df  # safety: never return nothing

    n = max(1, min(int(limit or 20), 50))
    sample = subset.sample(n=min(n, len(subset)))

    meta = MOOD_QUADRANTS[key]
    songs = []
    for _, row in sample.iterrows():
        title = str(row["track_name"])
        artist = str(row.get("artists", "") or "").replace(";", ", ")
        query = f"{title} {artist}".strip()
        dance = row.get("danceability")
        songs.append({
            "track_name": title,
            "artists": artist,
            "energy": round(float(row["energy"]), 3),
            "valence": round(float(row["valence"]), 3),
            "danceability": round(float(dance), 3) if pd.notna(dance) else None,
            "youtube_search_url": f"https://www.youtube.com/results?search_query={url_quote(query)}",
        })

    return {
        "mood": key,
        "emoji": meta["emoji"],
        "mood_name": meta["name"],
        "description": meta["description"],
        "cluster_id": int(cluster) if cluster is not None else None,
        "total_matches": int(len(subset)),
        "source": _playlist["source"],
        "songs": songs,
    }