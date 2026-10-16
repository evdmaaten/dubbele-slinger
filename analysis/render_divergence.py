"""Render the local single-video diagnostic JSON as a scientific PNG.

Run after analyze_divergence.mjs. Does not open video, alter measurements, fit
new models, or reinterpret video timestamps as confirmed physical seconds.
"""
from pathlib import Path
import argparse
import json
import os


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", nargs="?", default=".local-data/video-analyse", type=Path)
    args = parser.parse_args()
    directory = args.directory
    report = json.loads((directory / "faseruimte-divergentie.json").read_text(encoding="utf-8"))
    cache = directory / ".matplotlib-cache"
    cache.mkdir(exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(cache.resolve()))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    fig = plt.figure(figsize=(11.5, 9.5))
    ax = fig.add_axes([.10, .40, .64, .43])
    fit_start = report["method"]["fitWindowLagVideoSeconds"]["start"]
    fit_end = report["method"]["fitWindowLagVideoSeconds"]["end"]
    ax.axvspan(fit_start, fit_end, color="#e8eef2", label="Vast fitvenster")
    for result in report["scenarios"]:
        rows = [row for row in result["rows"] if row.get("valid", True) and np.isfinite(row.get("value", np.nan))]
        if rows:
            ax.plot([row["t"] for row in rows], [row["value"] for row in rows],
                    color=result["color"], lw=1.8, label=result["label"])
        fit = result.get("fit")
        if result["id"] == "basis" and fit:
            x = np.array([fit_start, fit_end])
            ax.plot(x, fit["intercept"] + fit["slope"] * x, color="#172936", lw=1.7, ls="--", label="Basisfit")
    ax.set_xlabel("Tijd sinds gekozen nabije toestanden (videoseconden)", labelpad=9)
    ax.set_ylabel("Gemiddelde ln[δ(t) / δ(0)]", labelpad=9)
    ax.set_xlim(0, report["scenarios"][0]["settings"]["horizon"])
    ax.grid(alpha=.2)
    ax.legend(loc="upper left", bbox_to_anchor=(1.03, 1), frameon=False, fontsize=8.5)
    fig.text(.07, .955, "Faseruimte-divergentie uit één opname", fontsize=21, weight="bold")
    fig.text(.07, .918, "Verkennende diagnose — tijd = videoseconden; fysieke tijdschaal onbekend", fontsize=11)
    window = report["provenance"]["analysedWindowVideoSeconds"]
    fig.text(.07, .885, f"Analyse {window['start']:g}–{window['end']:g} video-s; toestand [θ₁, θ₂, τ·ω₁, τ·ω₂]; τ = 1 video-s", fontsize=10.5)

    table_ax = fig.add_axes([.08, .155, .84, .16])
    table_ax.axis("off")
    table_rows = []
    for result in report["scenarios"]:
        fit = result.get("fit") or {}
        slope = f"{fit['slope']:.3f}" if isinstance(fit.get("slope"), (int, float)) and np.isfinite(fit["slope"]) else "—"
        r2 = f"{fit['r2']:.3f}" if isinstance(fit.get("r2"), (int, float)) and np.isfinite(fit["r2"]) else "—"
        table_rows.append([result["label"], str(result.get("pairCount", 0)), slope, r2])
    table = table_ax.table(cellText=table_rows,
                           colLabels=["Scenario", "Paren", "Helling /video-s", "R² (alleen fit)"],
                           colWidths=[.48, .12, .22, .18], loc="center", cellLoc="left")
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 1.4)
    for (row, column), cell in table.get_celld().items():
        cell.set_edgecolor("#d8e1e5")
        if row == 0:
            cell.set_facecolor("#e8eef2")
            cell.set_text_props(weight="bold")
    fig.text(.08, .115, "Geen bewezen Lyapunovexponent of chaos: gedempte opname, trackingruis en gedeelde trajectparen.", fontsize=10)
    fig.text(.08, .085, "Alle paren hebben een volledige horizon van 0,5 video-s. Afgekeurde frames blijven gaten.", fontsize=10)
    fig.text(.08, .055, "Fitvenster vooraf vast: 0,1–0,4 video-s. R² is geen validatie; geen onafhankelijke foutmarge berekend.", fontsize=10)
    output = directory / "faseruimte-divergentie.png"
    fig.savefig(output, dpi=170)
    plt.close(fig)
    print(output)


if __name__ == "__main__":
    main()
