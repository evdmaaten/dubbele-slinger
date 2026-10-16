"""Render the measured-path comparison JSON without fitting or changing results.

The generated figures and report are private local measurement products. Only
this source script belongs in the public repository. All plotted positions are
image pixels and all time axes are video time, regardless of scenario factor.
"""
from pathlib import Path
import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import math
import os


ORANGE = "#d46b13"
GREEN = "#128365"
INK = "#18333e"
MUTED = "#586a73"


def number(value, digits=2):
    if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
        return "—"
    return f"{value:.{digits}f}".replace(".", ",")


def escape(value):
    return html.escape(str(value))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wrap_for_plot(values, np):
    """Wrap image angles and break at +/-180, without changing scored angles."""
    result = (np.asarray(values, dtype=float) + 180.0) % 360.0 - 180.0
    jump = np.abs(np.diff(result)) > 180.0
    result[np.flatnonzero(jump) + 1] = np.nan
    return result


def style_axis(ax):
    ax.grid(alpha=.16, linewidth=.7)
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(labelsize=9)


def save_figure(fig, directory, stem, plt):
    fig.savefig(directory / f"{stem}.png", dpi=160, facecolor="white")
    fig.savefig(directory / f"{stem}.svg", facecolor="white")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path,
                        default=Path(".local-data/model-vergelijking"))
    args = parser.parse_args()
    directory = args.directory.resolve()
    input_path = directory / "vergelijking.json"
    report = json.loads(input_path.read_text(encoding="utf-8"))
    (directory / ".matplotlib-cache").mkdir(exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(directory / ".matplotlib-cache"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    import numpy as np

    # The calculation script supplies the entire protocol and every metric.
    # Schema-specific normalization is intentionally centralized here.
    scenarios = report["scenarios"]
    primary = next(s for s in scenarios if s["id"] == report["primaryScenario"])
    protocol = report
    measurements = primary["rows"]
    start = report["videoStart"]
    windows = primary["scores"]
    short = next(w for w in windows if w["id"] == "short")
    long = next(w for w in windows if w["id"] == "long")
    mt = np.array([r["tVideo"] for r in measurements], dtype=float)
    accepted = np.array([bool(r["valid"]) for r in measurements])
    mx = np.array([[r["measured"]["x1"], r["measured"]["x2"]] for r in measurements], dtype=float)
    my = np.array([[r["measured"]["y1"], r["measured"]["y2"]] for r in measurements], dtype=float)
    ma = np.array([r["measuredAnglesDeg"] for r in measurements], dtype=float)
    mx[~accepted] = np.nan
    my[~accepted] = np.nan
    ma[~accepted] = np.nan
    predicted = primary["rows"]
    st = np.array([r["tVideo"] for r in predicted], dtype=float)
    sa = np.array([r["modelAnglesDeg"] for r in predicted], dtype=float)
    residual = np.array([r["errorPx"] for r in predicted], dtype=float)
    pt = np.array([r["tVideo"] for r in primary["modelPath"]], dtype=float)
    sx = np.array([[r["x1"], r["x2"]] for r in primary["modelPath"]], dtype=float)
    sy = np.array([[r["y1"], r["y2"]] for r in primary["modelPath"]], dtype=float)
    if not len(st) or not len(mt):
        raise ValueError("No measurement or prediction rows to render.")

    # One extent, aspect ratio, origin, and orientation for every path panel.
    xx = np.concatenate([mx.reshape(-1), sx.reshape(-1), [0.]])
    yy = np.concatenate([my.reshape(-1), sy.reshape(-1), [0.]])
    xmin, xmax, ymin, ymax = np.nanmin(xx), np.nanmax(xx), np.nanmin(yy), np.nanmax(yy)
    span = max(50., xmax-xmin, ymax-ymin) * 1.12
    xlim = ((xmin+xmax-span)/2, (xmin+xmax+span)/2)
    ylim = ((ymin+ymax+span)/2, (ymin+ymax-span)/2)
    fig, axes = plt.subplots(2, 3, figsize=(15, 10.3), layout="constrained")
    colors = [ORANGE, GREEN]
    marker_names = ["Oranje marker", "Groene marker"]
    for ri, window in enumerate([short, long]):
        mm = (mt >= start - 1e-7) & (mt <= window["end"] + 1e-7)
        sm = (pt >= start - 1e-7) & (pt <= window["end"] + 1e-7)
        for ci, mode in enumerate(["Gemeten pad", "Simulatie", "Over elkaar"]):
            ax = axes[ri, ci]
            for j, color in enumerate(colors):
                if ci in (0, 2):
                    ax.plot(mx[mm, j], my[mm, j], color=color,
                            lw=1.2 if ci == 0 else 1.05,
                            alpha=.85 if ci == 0 else .5)
                if ci in (1, 2):
                    ax.plot(sx[sm, j], sy[sm, j], color=color,
                            lw=1.2, ls="--" if ci == 2 else "-")
                for xx, yy, mask, active in [(mx, my, mm, ci in (0, 2)),
                                               (sx, sy, sm, ci == 1)]:
                    valid = np.flatnonzero(mask & np.isfinite(xx[:, j]) & np.isfinite(yy[:, j]))
                    if active and len(valid):
                        ax.scatter(xx[valid[0], j], yy[valid[0], j], s=25,
                                   color=color, edgecolors="white", linewidths=.7, zorder=6)
            ax.scatter(0, 0, s=23, c=INK, marker="+", zorder=8)
            ax.set_xlim(*xlim)
            ax.set_ylim(*ylim)
            ax.set_aspect("equal", adjustable="box")
            ax.set_title(f"{mode} · {number(start,1)}–{number(window['end'],1)} video-s",
                         loc="left", fontsize=11.5, pad=10)
            ax.set_xlabel("x t.o.v. draaipunt (px) →")
            if ci == 0:
                ax.set_ylabel("y t.o.v. draaipunt (px) ↓")
            style_axis(ax)
    handles = [Line2D([0], [0], color=c, lw=2, label=n) for c,n in zip(colors, marker_names)]
    handles += [Line2D([0],[0],color=MUTED,lw=1.4,label="Gemeten = doorgetrokken"),
                Line2D([0],[0],color=MUTED,lw=1.4,ls="--",label="Simulatie = streep in overlay")]
    fig.legend(handles=handles, loc="outside lower center", ncol=4, frameon=False, fontsize=10)
    fig.suptitle("Gemeten markerpaden en simulatie met staafmassa’s\n"
                 + primary["label"] + " · uniforme staven; voorwaardelijke vergelijking",
                 fontsize=17, fontweight="bold", color=INK)
    save_figure(fig, directory, "padvergelijking", plt)

    fig, axes = plt.subplots(3, 1, figsize=(13.8, 10), sharex=True, layout="constrained")
    for j, ax in enumerate(axes[:2]):
        measured_angle = wrap_for_plot(ma[:,j],np)
        model_angle = wrap_for_plot(sa[:,j],np)
        ax.plot(mt, measured_angle, color=colors[j], lw=1.15, label="Gemeten beeldhoek")
        ax.plot(st, model_angle, color=INK, lw=1.1, ls="--", label="Simulatie")
        ax.set_ylabel(f"θ{j+1} (graden)")
        angle_bound = max(15., math.ceil(float(np.nanmax(np.abs(np.r_[measured_angle,model_angle]))) * 1.08 / 15.) * 15.)
        ax.set_ylim(-angle_bound,angle_bound)
        ax.set_title(f"{'Bovenste' if j==0 else 'Onderste'} staaf · hoek t.o.v. verticale beeldas",
                     loc="left", fontsize=11)
        ax.legend(loc="upper right", ncol=2, frameon=True, framealpha=.9, fontsize=9)
        style_axis(ax)
    for j, color in enumerate(colors):
        axes[2].plot(st, residual[:,j], color=color, lw=1.15, label=marker_names[j])
    axes[2].set_ylabel("Positieverschil (px)")
    axes[2].set_title("Afstand tussen gelijktijdige gemeten en voorspelde markercentra", loc="left", fontsize=11)
    axes[2].legend(loc="upper right", ncol=2, fontsize=9)
    axes[2].set_ylim(bottom=0)
    axes[2].set_xlabel("Tijd in het videobestand (video-s); fysieke tijdschaal nog onbevestigd")
    for ax in axes:
        style_axis(ax)
        ax.axvspan(start, report["scoreStart"], color="#dce5e9", alpha=.7)
        ax.axvline(short["end"], color="#83939a", ls=":", lw=.9)
        ax.set_xlim(start, long["end"])
    fig.suptitle("Overeenkomst op hetzelfde videotijdstip\n" + primary["label"],
                 fontsize=17, fontweight="bold", color=INK)
    fig.supxlabel("Gaten = afgekeurde metingen; hoeken bij ±180° onderbroken. Grijs = niet gescoord; stippellijn = einde korte venster.", fontsize=10)
    save_figure(fig, directory, "tijdvergelijking", plt)

    # HTML metrics and explanatory content are assembled after normalization.
    report_html = build_html(report, primary, protocol, scenarios)
    (directory / "rapport.html").write_text(report_html, encoding="utf-8")
    products = ["padvergelijking.png", "padvergelijking.svg", "tijdvergelijking.png",
                "tijdvergelijking.svg", "rapport.html"]
    manifest = {
        "schema": "dubbele-slinger/model-comparison-render/v1",
        "createdUtc": datetime.now(timezone.utc).isoformat(),
        "input": {"file": input_path.name, "sha256": sha256(input_path)},
        "rendererSha256": sha256(Path(__file__)),
        "outputs": [{"file": name, "sha256": sha256(directory / name)} for name in products],
        "transformations": ["Angle traces wrapped to [-180,180) for display only; wrap joins removed.",
                            "Rejected measurements remain gaps; no fitting, smoothing or replacement.",
                            "Shared pixel scale in all path panels; no claim of calibrated metric distance."]
    }
    (directory / "render-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n", encoding="utf-8")
    print(json.dumps({"report": str(directory / "rapport.html"), "outputs": products}, ensure_ascii=False))


def build_html(report, primary, protocol, scenarios):
    confirmed = report["confirmed"]
    projection = report["projection"]
    initial = report["initial7"]
    short = next(w for w in primary["scores"] if w["id"] == "short")
    long = next(w for w in primary["scores"] if w["id"] == "long")
    first = next(w for w in primary["scores"] if w["id"] == "first")
    window_names = {"first":"Heel kort", "short":"Kort", "long":"Volledig"}
    def interval(w):
        return f"{number(w['start'],1)}–{number(w['end'],1)}"
    def metric_cells(w):
        return "".join(f"<td>{number(v,2)}</td>" for v in
                       [w["positionPx"][0]["rmse"],w["positionPx"][1]["rmse"],
                        w["angleDeg"][0]["rmse"],w["angleDeg"][1]["rmse"]])
    primary_rows = "".join(
        f"<tr><th>{window_names[w['id']]}<small>{interval(w)} video-s</small></th>"
        f"<td>{w['count']} / {w['expectedCount']}</td>{metric_cells(w)}</tr>"
        for w in [first, short, long])
    scenario_rows = []
    for s in scenarios:
        for i, wid in enumerate(["first","short","long"]):
            w = next(w for w in s["scores"] if w["id"] == wid)
            name = f"<th rowspan='3'>{escape(s['label'])}<small>{'Hoofdscenario · ' if s['id']==primary['id'] else ''}c₁={number(s['params']['c1'],3)}, c₂={number(s['params']['c2'],3)} N·m·s/rad</small></th>" if i==0 else ""
            scenario_rows.append(f"<tr class='{'group' if i==0 else ''}'>{name}<td>{window_names[wid]}<small>{interval(w)} video-s</small></td>{metric_cells(w)}</tr>")
    geometry_rows = "".join(
        f"<tr><th>{number(g['videoRange'][0],1)}–{number(g['videoRange'][1],1)} video-s</th><td>{g['count']}</td>"
        f"<td>{number(g['upperRadiusPx']['median'])}</td><td>{number(g['lowerRadiusPx']['median'])}</td></tr>"
        for g in report["geometryWindows"])
    profile_links = "".join(f"<li><a href='{escape(s['profileFile'])}'>{escape(s['label'])}</a></li>" for s in scenarios)
    upper, lower = initial["fits"]
    # The physical rate depends on the chosen time factor. Image-time rates are
    # also shown so the assumed conversion can be checked independently.
    source_hash = report["sources"]["pathCSV"]["sha256"]
    convergence = report["numericalCheck"]["maxPositionDifferenceProjectedPx"]
    return f"""<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Videopad naast simulatie · dubbele slinger</title>
<style>
:root{{color-scheme:light;--ink:{INK};--muted:{MUTED};--line:#dbe3e7;--light:#f1f5f6}}
*{{box-sizing:border-box}}body{{margin:0;background:#eef2f3;color:var(--ink);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}}
main{{max-width:1240px;margin:28px auto;padding:36px;background:white;border-radius:14px}}
h1{{font-size:clamp(28px,4vw,42px);line-height:1.13;letter-spacing:-.025em;margin:10px 0 18px}}h2{{font-size:25px;margin:38px 0 10px;line-height:1.25}}h3{{font-size:19px;margin:24px 0 8px}}
p{{max-width:100ch;margin:12px 0}}.eyebrow{{font-size:12px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}}
.lead{{font-size:20px;line-height:1.5}}.note{{border-left:4px solid #d69532;background:#fff6e8;padding:14px 18px;margin:22px 0}}
.facts{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}}.fact{{background:var(--light);padding:15px;border-radius:8px}}.fact strong{{display:block;font-size:23px}}.fact span{{display:block;color:var(--muted);font-size:13px}}
figure{{margin:20px 0 32px}}figure img{{display:block;width:100%;height:auto;background:white;border:1px solid var(--line);border-radius:6px}}figcaption{{font-size:14px;color:var(--muted);margin:8px 0}}
.table-wrap{{overflow-x:auto;margin:18px 0}}table{{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:14px}}th,td{{text-align:right;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}}th:first-child,td:first-child{{text-align:left}}thead th{{background:var(--light);font-weight:700}}tbody th{{font-weight:600}}small{{display:block;font-size:12px;color:var(--muted);font-weight:400;white-space:nowrap}}.group th,.group td{{border-top:2px solid #b9c9d1}}td{{white-space:nowrap}}
a{{color:#006a86;text-decoration-thickness:1px;text-underline-offset:3px}}ul{{padding-left:22px}}li{{margin:7px 0}}code{{font-size:12px;overflow-wrap:anywhere}}details{{margin:24px 0;padding:18px;background:var(--light);border-radius:8px}}summary{{font-weight:700;cursor:pointer}}footer{{margin-top:32px;padding-top:15px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}}
@media(max-width:700px){{main{{padding:20px;margin:0;border-radius:0}}.facts{{grid-template-columns:repeat(2,1fr)}}th,td{{padding:8px}}}}
</style></head><body><main>
<div class="eyebrow">Practicum · gemeten beweging en voorwaartse simulatie</div>
<h1>Het gemeten pad naast de simulatie</h1>
<p class="lead">Met de bevestigde staafmassa’s bedraagt het RMS-positieverschil in het korte venster
({interval(short)} video-s) <strong>{number(short['positionPx'][0]['rmse'])} pixels voor de oranje marker</strong>
en <strong>{number(short['positionPx'][1]['rmse'])} pixels voor de groene marker</strong> in het hoofdscenario.</p>
<p>De simulatie start op {number(report['videoStart'],1)} video-s, met uit de opname geschatte hoeken en beginsnelheden.
De toekomstige meetpunten zijn niet gebruikt om de modelparameters beter te laten passen.</p>
<div class="facts">
<div class="fact"><strong>{number(confirmed['rodMass1'],4)} kg</strong><span>bovenste staaf · {number(1000*confirmed['s1'],0)} mm</span></div>
<div class="fact"><strong>{number(confirmed['rodMass2'],4)} kg</strong><span>onderste staaf · {number(1000*confirmed['s2'],0)} mm</span></div>
<div class="fact"><strong>0 kg / 0 kg</strong><span>extra puntmassa’s · gele vierkantjes zijn markers</span></div>
<div class="fact"><strong>{long['count']} / {long['expectedCount']}</strong><span>geldige markerparen in volledig scorevenster</span></div>
</div>
<div class="note"><strong>Dit is een voorwaardelijke vergelijking.</strong> Het getoonde hoofdscenario is
<strong>{escape(primary['label'])}</strong>. De factor 8 is een nog onbevestigde mogelijkheid bij 240 fps opname en 30 fps afspelen.
De afspeelfactor, camera- en markergeometrie, massaverdeling en demping zijn nog niet onafhankelijk gekalibreerd.
Een visueel vergelijkbaar pad alleen bewijst geen overeenkomst op dezelfde tijdstippen.</div>

<h2>De markerpaden: dezelfde oorsprong en pixelschaal</h2>
<p>Links staat de meting, in het midden de simulatie en rechts de overlay. De bovenste rij toont het begin;
de onderste rij de volledige vergelijking. Alle zes panelen hebben exact dezelfde asgrenzen en schaal.
Het vaste draaipunt is de oorsprong, x loopt naar rechts en y naar beneden. Een punt markeert de eerste beschikbare positie.</p>
<figure><img src="padvergelijking.png" alt="Gemeten en voorspelde oranje en groene markerpaden naast elkaar en over elkaar, voor een kort en een lang venster">
<figcaption>Oranje en groen geven de twee markers aan. In de overlay is de simulatie gestreept.
Afgekeurde metingen blijven gaten. <a href="padvergelijking.svg">Download als SVG</a>.</figcaption></figure>

<h2>Overeenkomst op hetzelfde tijdstip</h2>
<p>Het positieverschil is de afstand tussen een gemeten markercentrum en de voorspelling voor datzelfde videoframe.
RMS is de wortel van het gemiddelde gekwadrateerde verschil; grote afwijkingen tellen daardoor sterker mee.
De hoekverschillen zijn rond ±180° gewikkeld voordat RMS wordt berekend.</p>
<div class="table-wrap"><table><thead><tr><th>Venster</th><th>Geldige paren / frames</th><th>Oranje RMS (px)</th><th>Groen RMS (px)</th><th>θ₁ RMS (°)</th><th>θ₂ RMS (°)</th></tr></thead><tbody>{primary_rows}</tbody></table></div>
<p>De {long['rejectedCount']} afgekeurde markerparen in het volledige venster zijn uitgesloten van de scores;
ze zijn niet geïnterpoleerd of vervangen door de simulatie. Er wordt geen gekalibreerde fout in millimeters of percentage overeenkomst afgeleid.</p>
<figure><img src="tijdvergelijking.png" alt="Twee hoekgrafieken en de positieverschillen van beide markers tegen videotijd">
<figcaption>Hoeken zijn beeldhoeken, uitgedrukt ten opzichte van de neerwaartse verticale beeldas.
Het grijze begin telt niet mee in de scores. <a href="tijdvergelijking.svg">Download als SVG</a>.</figcaption></figure>

<h2>De gevoeligheid voor aannames</h2>
<p>Dezelfde toekomstige frames zijn vergeleken met vijf vooraf gekozen scenario’s. Factor 1 staat voor normale snelheid,
factor 8 voor achtmaal vertraagde weergave. De voorbeeldwaarden voor demping zijn niet uit de opname geschat.
Het scenario met 11 startframes verandert alleen het venster waarmee de beginbeweging wordt bepaald.</p>
<div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Venster</th><th>Oranje RMS (px)</th><th>Groen RMS (px)</th><th>θ₁ RMS (°)</th><th>θ₂ RMS (°)</th></tr></thead><tbody>{''.join(scenario_rows)}</tbody></table></div>
<p><strong>Een lagere gemiddelde afwijking kiest geen bewezen juiste tijdsfactor.</strong> Over een lang venster kunnen
uitdoving, amplitudeverschillen en fases die toevallig dichter bij elkaar liggen de score verlagen.
De tijdschaal moet worden vastgesteld uit de opname-instellingen of een onafhankelijke tijdreferentie.</p>

<h2>Wat is gebruikt, en wat moet nog worden gemeten?</h2>
<ul>
<li><strong>Bevestigd:</strong> staaflengtes {number(1000*confirmed['s1'],0)} en {number(1000*confirmed['s2'],0)} mm;
staafmassa’s {number(confirmed['rodMass1'],4)} en {number(confirmed['rodMass2'],4)} kg; geen extra puntmassa’s voor de markers.</li>
<li><strong>Model:</strong> twee uniforme, slanke stijve staven. De echte massaverdeling, positie van het massamiddelpunt,
traagheidsmomenten en eventuele delen voorbij een scharnier zijn nog niet gemeten.</li>
<li><strong>Begintoestand:</strong> een lokale lineaire fit over {initial['frameCount']} geaccepteerde frames
({number(initial['videoWindow'][0],2)}–{number(initial['videoWindow'][1],2)} video-s).
Bij {number(report['videoStart'],1)} video-s zijn θ₁ = {number(upper['angleDeg'])}° en θ₂ = {number(lower['angleDeg'])}°;
de gemeten hellingen zijn {number(upper['slopeDegPerVideoSecond'])} en {number(lower['slopeDegPerVideoSecond'])} °/video-s.
De hoeksnelheden voor het model zijn deze hellingen maal de gekozen tijdsfactor. Scoren begint pas op {number(report['scoreStart'],1)} video-s.</li>
<li><strong>Projectie:</strong> de oranje stip wordt voorlopig gelijkgesteld aan het tweede scharnier.
Uit {projection['baselineCount']} rustige frames tussen {number(projection['baselineVideo'][0],1)} en {number(projection['baselineVideo'][1],1)} video-s
volgt een veronderstelde schaal van {number(projection['pixelsPerMeter'])} px/m. De groene stip ligt in deze projectie op
{number(100*projection['marker2Fraction'],1)}% van de onderste staaf. Dit is een afleiding uit het beeld, geen onafhankelijke geometrische meting.</li>
<li><strong>Camera:</strong> beeld-verticaal wordt voorlopig gelijkgesteld aan de zwaartekrachtrichting;
er is geen perspectiefcorrectie. De beweging van het gevolgde draaipunt is van de markerposities afgetrokken.</li>
</ul>
<p>De gemeten afstand tussen de oranje en groene stip verandert tijdens de beweging. Een constante afstand wordt hier alleen verwacht
als de oranje stip precies op het tweede scharnier ligt en de beeldprojectie de afstand behoudt. Twee vaste markers op verschillende
staven kunnen wel een wisselende onderlinge afstand hebben wanneer de oranje stip naast de scharnieras ligt.
Daarom moeten vooral die scharnieraanname, de exacte markerposities en de projectie worden gecontroleerd; deze variatie betekent niet dat de staaflengte verandert:</p>
<div class="table-wrap"><table><thead><tr><th>Videovenster</th><th>Geldige paren</th><th>Mediaan draaipunt → oranje (px)</th><th>Mediaan oranje → groen (px)</th></tr></thead><tbody>{geometry_rows}</tbody></table></div>

<details><summary>Reproduceerbare bestanden en instellingen</summary>
<p>De berekening gebruikt dezelfde <code>physics.js</code> als de HTML-interface.
Halvering van de integratiestap geeft maximaal {convergence:.3g} px verschil in de geprojecteerde modelposities
voor het hoofdscenario. Dit controleert de numerieke uitvoering; het is geen bevestiging van de fysieke aannames.</p>
<p><a href="vergelijking.json">Alle resultaten en herkomst (JSON)</a> · <a href="afwijkingen.csv">Verschillen per frame (CSV)</a> ·
<a href="../video-analyse/bewegingspaden.csv">Gemeten paden voor de HTML-interface</a></p>
<p>Importeer een instellingenbestand in de HTML-interface en laad daarna het gemeten padenbestand:</p><ul>{profile_links}</ul>
<p>SHA-256 van het gebruikte padenbestand:<br><code>{escape(source_hash)}</code></p>
<p>De gegevens en dit rapport zijn lokaal opgeslagen; de video en meetbestanden zijn niet voor publicatie bestemd.</p>
</details>
<footer>Uitvoer van een vergelijking met vaste aannames. Gemaakt uit <code>vergelijking.json</code>; deze rapportstap past geen model of meetgegevens aan.</footer>
</main></body></html>"""


if __name__ == "__main__":
    main()
