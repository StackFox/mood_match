"""
Re-render the Compare-page cluster plots (KMeans / HDBSCAN / GMM) with the
CORRECTED cluster names.

History: the original notebook assigned display names to cluster labels in a
different order than the pickled models number them, so the exported PNGs
showed scrambled legends (e.g. the 67% mainstream blob labeled
"Live / Electronic"). The app's dicts in main.py were re-keyed to the models'
actual label numbering (verified via per-label feature means on df_feat.csv).

This script derives names/colors directly from main.py so the plots can never
drift from the app again, and re-runs the notebook's UMAP projection with the
same parameters (n_neighbors=30, min_dist=0.1, random_state=42) so the layout
matches the original exports as closely as UMAP allows.

Run from backend/:  ./.venv/bin/python render_plots.py
Output: ../frontend/public/plots/{KMeans,phase4_hdbscan_final,phase4_gmm_final}.png
"""
import os
import sys
import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import umap

import main  # loads models, scalers, playlist data + corrected cluster dicts

SEED = 42
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "plots")
PROFILE_FEATURES = ["mood_ev", "mood_dark", "mood_groove", "acousticness_log", "liveness_log"]


def cluster_names_colors(dicts):
    """{label: name} / {label: color} from main.py's corrected dicts."""
    names = {k: v["name"] for k, v in dicts.items()}
    colors = {k: v["color"] for k, v in dicts.items()}
    return names, colors


def scatter_and_bars(names, colors, labels, embedding, title, bar_title,
                     out_path, noise_first=False, bar_order=None):
    """Notebook-faithful two-panel figure: UMAP scatter + profile bars."""
    df = main._playlist["df"]
    fig = plt.figure(figsize=(14, 11))
    gs = fig.add_gridspec(2, 1, height_ratios=[2.2, 1], hspace=0.35)
    ax_scatter = fig.add_subplot(gs[0])
    ax_bar = fig.add_subplot(gs[1])

    order = list(names.keys())
    if noise_first and -1 in order:
        order = [-1] + [k for k in order if k != -1]

    for cid in order:
        if cid == -1:
            mask = labels == -1
            ax_scatter.scatter(embedding[mask, 0], embedding[mask, 1],
                               c=colors[cid], alpha=0.08, s=2,
                               label=f"Noise / boundary  (n={int(mask.sum()):,})",
                               rasterized=True)
            continue
        mask = labels == cid
        ax_scatter.scatter(embedding[mask, 0], embedding[mask, 1],
                           c=colors[cid], label=f"{names[cid]}  (n={int(mask.sum()):,})",
                           alpha=0.3 if noise_first else 0.18, s=3, rasterized=True)

    # centroid markers + annotations (mean of embedded coords, as in the notebook)
    for cid in order:
        if cid == -1:
            continue
        mask = labels == cid
        cx, cy = embedding[mask, 0].mean(), embedding[mask, 1].mean()
        ax_scatter.scatter(cx, cy, c=colors[cid], s=180, marker="X",
                           edgecolors="white", linewidths=0.8, zorder=5)
        ax_scatter.annotate(names[cid], xy=(cx, cy), xytext=(8, 6),
                            textcoords="offset points", fontsize=9, fontweight="500",
                            color=colors[cid],
                            bbox=dict(boxstyle="round,pad=0.3", fc="white",
                                      alpha=0.75, ec="none"))

    ax_scatter.set_xlabel("UMAP dimension 1", fontsize=10)
    ax_scatter.set_ylabel("UMAP dimension 2", fontsize=10)
    ax_scatter.set_title(title, fontsize=12, pad=10)
    ax_scatter.tick_params(left=False, bottom=False, labelleft=False, labelbottom=False)
    legend = ax_scatter.legend(title="Mood cluster", title_fontsize=9.5, fontsize=9,
                               framealpha=0.9, edgecolor="#cccccc",
                               loc="upper right", markerscale=4)
    legend.get_title().set_fontweight("500")
    sns.despine(ax=ax_scatter, left=True, bottom=True)

    # profile bars (unscaled stored means per label; noise excluded)
    prof_df = df if -1 not in names else df[labels != -1]
    lab_series = pd.Series(labels if -1 not in names else labels[labels != -1],
                           index=prof_df.index)
    prof = prof_df[PROFILE_FEATURES].groupby(lab_series).mean()

    bar_labels = bar_order or [k for k in names if k != -1]
    x = np.arange(len(PROFILE_FEATURES))
    width = 0.18
    offset = np.linspace(-(len(bar_labels) - 1) / 2, (len(bar_labels) - 1) / 2,
                         len(bar_labels)) * width

    for i, cid in enumerate(bar_labels):
        ax_bar.bar(x + offset[i], prof.loc[cid], width=width, label=names[cid],
                   color=colors[cid], alpha=0.82, edgecolor="white", linewidth=0.5)

    ax_bar.set_xticks(x)
    ax_bar.set_xticklabels(PROFILE_FEATURES, fontsize=9.5)
    ax_bar.set_ylabel("mean value (unscaled)", fontsize=9)
    ax_bar.set_title(bar_title, fontsize=11)
    ax_bar.legend(fontsize=8.5, ncol=2, framealpha=0.8, edgecolor="#cccccc")
    sns.despine(ax=ax_bar)

    fig.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close(fig)
    print(f"saved {out_path}")


def main_render():
    sns.set_theme(style="whitegrid")
    df = main._playlist["df"]
    X_scaled = main.scalers["aug"].transform(df[main.PLAYLIST_FEATURES].to_numpy(float))

    print("predicting labels with the trained models...")
    km_labels = main.models["kmeans"].predict(X_scaled)
    from hdbscan.prediction import approximate_predict
    hdb_labels, _ = approximate_predict(main.models["hdbscan"], X_scaled)
    gmm_labels = main.models["gmm"].predict(X_scaled)

    print("fitting UMAP (n_neighbors=30, min_dist=0.1, random_state=42) — 1-2 min...")
    embedding = umap.UMAP(n_components=2, n_neighbors=30, min_dist=0.1,
                          random_state=SEED).fit_transform(X_scaled)
    print("UMAP done:", embedding.shape)

    os.makedirs(OUT_DIR, exist_ok=True)

    km_names, km_colors = cluster_names_colors(main.KMEANS_CLUSTERS)
    scatter_and_bars(
        km_names, km_colors, km_labels, embedding,
        title="K-Means clusters (k=4) — UMAP projection\naugmented features",
        bar_title="Cluster feature profiles — augmented",
        out_path=os.path.join(OUT_DIR, "KMeans.png"),
    )

    hdb_names, hdb_colors = cluster_names_colors(main.HDBSCAN_CLUSTERS)
    scatter_and_bars(
        hdb_names, hdb_colors, hdb_labels, embedding,
        title="HDBSCAN clusters — UMAP projection\naugmented features  (noise shown in gray)",
        bar_title="Cluster feature profiles — HDBSCAN",
        out_path=os.path.join(OUT_DIR, "phase4_hdbscan_final.png"),
        noise_first=True,
    )

    gmm_names, gmm_colors = cluster_names_colors(main.GMM_CLUSTERS)
    scatter_and_bars(
        gmm_names, gmm_colors, gmm_labels, embedding,
        title="GMM clusters (k=4, spherical) — UMAP projection\naugmented features",
        bar_title="Cluster feature profiles — GMM (spherical)",
        out_path=os.path.join(OUT_DIR, "phase4_gmm_final.png"),
    )


if __name__ == "__main__":
    main_render()
    sys.exit(0)
