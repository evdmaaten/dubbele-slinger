"""Render an already scored local tracking benchmark, without changing detections.

All images and measurements are local outputs. Source scripts may be shared;
do not publish the generated report or video frames without separate approval.
"""
import argparse
import csv
import hashlib
import html
import json
import os
from pathlib import Path

import numpy as np


METHODS = [('notebook_original', 'raw'), ('notebook_controlled', 'raw'),
           ('ours', 'raw'), ('ours', 'quality_accepted')]
LABELS = ['Notebook\norigineel', 'Notebook\nzelfde kleuren',
          'Onze tracker\nruw', 'Onze tracker\nna selectie']
COLORS = ['#c64036', '#9461c9', '#007b90', '#46723a']


def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def fmt(number, digits=2):
    return '—' if number is None else f'{number:.{digits}f}'.replace('.', ',')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    os.environ.setdefault('MPLCONFIGDIR', str(directory / '.matplotlib-cache'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Circle
    from matplotlib.lines import Line2D
    summary = json.loads((directory / 'accuracy-summary.json').read_text(encoding='utf-8'))
    run = json.loads((directory / 'prediction-run.json').read_text(encoding='utf-8'))
    protocol = json.loads((directory / 'reference-protocol.json').read_text(encoding='utf-8'))
    details = read_csv(directory / 'accuracy-by-frame.csv')
    predictions = read_csv(directory / 'predictions-selected-frames.csv')
    a = json.loads((directory / 'annotations-A.json').read_text(encoding='utf-8'))['rows']
    b = json.loads((directory / 'annotations-B.json').read_text(encoding='utf-8'))['rows']
    readers = [{(r['frame'], r['marker']): r for r in rows} for rows in [a, b]]
    agreement = np.array([r['observer_distance_px'] for r in summary['observer_agreement']])
    if not len(agreement):
        raise ValueError('No jointly visible references to render.')
    uncertainty = [r['conservative_visual_uncertainty_px'] for r in summary['observer_agreement']]
    uncertainty_label = f'{fmt(min(uncertainty),0)}–{fmt(max(uncertainty),0)}'
    regular_original = next(r for r in summary['summaries'] if (r['cohort'],r['marker'],r['method']) == ('regular','orange','notebook_original'))
    regular_medians = [r['median_error_px'] for r in summary['summaries'] if r['cohort']=='regular' and r['method']!='notebook_original' and r['variant']=='raw' and r['median_error_px'] is not None]
    stress_misses = [r for r in details if r['cohort']=='stress' and r['method']=='ours' and r['variant']=='raw' and r['marker']=='orange' and r['detected']=='1' and float(r['error_px'])>10]
    miss_description = '; '.join(f"frame {r['frame']}: {fmt(float(r['error_px']))} px" for r in stress_misses) or 'geen afwijking boven 10 px'

    fig, axes = plt.subplots(2, 2, figsize=(13.5, 9), dpi=160, layout='constrained')
    for ri, cohort in enumerate(['regular', 'stress']):
        for ci, marker in enumerate(['orange', 'green']):
            ax = axes[ri, ci]
            indices = range(4) if marker == 'orange' else range(1, 4)
            tick_labels = []
            for mi in indices:
                method, variant = METHODS[mi]
                rows = [r for r in details if (r['cohort'], r['marker'], r['method'], r['variant']) == (cohort, marker, method, variant)]
                errors = [float(r['error_px']) for r in rows if r['detected'] == '1']
                jitter = np.linspace(-.13, .13, len(errors)) if errors else []
                ax.scatter(mi + np.array(jitter), errors, s=26, c=COLORS[mi], alpha=.7, edgecolors='white', linewidths=.3)
                if errors:
                    ax.plot([mi-.23, mi+.23], [np.median(errors)]*2, color=COLORS[mi], linewidth=2.5)
                tick_labels.append(f'{LABELS[mi]}\n{len(errors)}/{len(rows)} posities')
            ax.axhline(5, color='#8d6a2c', linestyle='--', linewidth=.8)
            ax.axhline(10, color='#8d6a2c', linestyle=':', linewidth=.8)
            ax.set_yscale('symlog', linthresh=3)
            ax.set_ylim(0, 700)
            ax.set_yticks([0, 1, 2, 5, 10, 50, 100, 500], labels=['0','1','2','5','10','50','100','500'])
            ax.set_xticks(list(indices), tick_labels, fontsize=9)
            ax.set_ylabel('Afstand tot visuele referentie (px)')
            sample = '25 verspreide frames' if cohort == 'regular' else '6 extra moeilijke frames'
            ax.set_title(f'{sample} · {"oranje" if marker == "orange" else "groen"}', loc='left', fontsize=12)
            ax.grid(axis='y', alpha=.15)
            ax.spines[['top','right']].set_visible(False)
    fig.suptitle('Markertracking op dezelfde videoframes', fontsize=19, fontweight='bold')
    fig.supxlabel(f'Streep = mediaan; punten = alle beschikbare posities. Y-as logaritmisch boven 3 px.\nReferentie: gemiddelde van twee AI-visuele lezingen, geschatte onzekerheid {uncertainty_label} px; geen gekalibreerde grondwaarheid.', fontsize=10)
    fig.savefig(directory / 'tracker-vergelijking.png')
    fig.savefig(directory / 'tracker-vergelijking.svg')
    plt.close(fig)

    overlay_dir = directory / 'overlays'
    overlay_dir.mkdir(exist_ok=True)
    gallery = []
    # Every selected frame is shown; no post-result subset is presented as representative.
    for frame in sorted(protocol['regular_frames'] + protocol['stress_frames']):
        image_name = f'frame-{frame:04d}.png'
        picture = plt.imread(directory / 'reference-frames' / image_name)
        fig, ax = plt.subplots(figsize=(10.24, 6.4), dpi=130, layout='constrained')
        ax.imshow(picture)
        for marker in ['orange', 'green']:
            ra, rb = [reader[(frame, marker)] for reader in readers]
            if not (ra['visible'] and rb['visible']):
                continue
            x, y = (ra['x_px']+rb['x_px'])/2, (ra['y_px']+rb['y_px'])/2
            radius = max(ra['uncertainty_px'], rb['uncertainty_px'], np.hypot(ra['x_px']-rb['x_px'], ra['y_px']-rb['y_px'])/2)
            ax.add_patch(Circle((x, y), radius, facecolor='none', edgecolor='white', linewidth=1.2))
            ax.scatter([x], [y], marker='+', color='white', s=70, linewidth=1)
        statuses = []
        for mi, (method, variant) in enumerate(METHODS[:3]):
            for row in [p for p in predictions if p['method'] == method and int(p['frame']) == frame]:
                marker_name = 'oranje' if row['marker'] == 'orange' else 'groen'
                if row['detected'] != '1':
                    statuses.append(f'{LABELS[mi].replace(chr(10), " ")} {marker_name}: ontbreekt')
                    continue
                x, y = float(row['x_px']), float(row['y_px'])
                if mi == 0:
                    ax.scatter([x], [y], marker='x', s=65, color=COLORS[mi], linewidth=1.5)
                else:
                    ax.scatter([x], [y], marker=['x','s','o'][mi], s=[65,75,110][mi],
                               facecolors='none', edgecolors=COLORS[mi], linewidth=1.5)
                if mi == 2 and row['accepted'] != '1':
                    statuses.append(f'Onze {marker_name}: afgekeurd ({row["quality_reason"]})')
        ax.set_xlim(0,1024); ax.set_ylim(576,0)
        ax.set_xlabel('x (originele pixels)'); ax.set_ylabel('y (originele pixels, omlaag)')
        group = 'verspreide steekproef' if frame in protocol['regular_frames'] else 'extra moeilijk beeld'
        ax.set_title(f'Frame {frame} · {frame/30:.3f} video-s · {group}', loc='left')
        handles = [Line2D([],[],color=COLORS[mi], marker=['x','s','o'][mi], linestyle='none',
                          markerfacecolor='none', label=LABELS[mi].replace('\n',' ')) for mi in range(3)]
        handles.append(Line2D([],[],color='gray',marker='+',linestyle='none',label='Visuele referentie (witte cirkel)'))
        ax.legend(handles=handles, loc='upper left', ncols=2, fontsize=8, framealpha=.9)
        fig.savefig(overlay_dir / image_name)
        plt.close(fig)
        status_html = '<br>'.join(html.escape(s) for s in statuses) or 'Beide methoden leveren posities.'
        gallery.append(f'<details><summary>Frame {frame} · {frame/30:.3f} video-s · {group}</summary><img loading="lazy" src="overlays/{image_name}" alt="Detecties in frame {frame}"><p>{status_html}</p><p><a href="reference-frames/{image_name}">Origineel zonder annotaties</a> · <a href="reference-grids/{image_name}">Blind referentiebeeld met pixelraster</a></p></details>')

    tables = []
    for cohort, label in [('regular','25 verspreide frames'),('stress','6 extra moeilijke frames')]:
        rows = []
        for row in summary['summaries']:
            if row['cohort'] != cohort:
                continue
            idx = METHODS.index((row['method'], row['variant']))
            rows.append('<tr>'+''.join(f'<td>{v}</td>' for v in [
                LABELS[idx].replace('\n',' '), 'Oranje' if row['marker']=='orange' else 'Groen',
                f'{row["detected_count"]}/{row["reference_count"]}', fmt(row['median_error_px']),
                fmt(row['p90_error_px']), fmt(row['rmse_px']),
                fmt(100*row['within5px_all_reference_fraction'],0)+'%',
                fmt(100*row['within10px_all_reference_fraction'],0)+'%'])+'</tr>')
        tables.append(f'<h2>{label}</h2><div class="table"><table><thead><tr><th>Methode</th><th>Marker</th><th>Posities</th><th>Mediaan px</th><th>P90 px</th><th>RMSE px</th><th>≤5 px / alle</th><th>≤10 px / alle</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>')
    report = f'''<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vergelijking markertracking · dubbele slinger</title><style>
body{{margin:0;background:#f4f3ed;color:#17343f;font:17px/1.6 system-ui,sans-serif}}main{{max-width:1160px;margin:auto;padding:40px 24px}}
h1{{font-size:clamp(30px,4vw,48px);line-height:1.12}}h2{{margin-top:2em}}p{{max-width:90ch}}.notice{{padding:18px 22px;background:#e2ede7;border-left:4px solid #007b90}}
img{{width:100%;height:auto;background:white}}a{{color:#005f77}}.table{{overflow:auto}}table{{border-collapse:collapse;min-width:850px;width:100%;font-size:14px;background:white}}th,td{{padding:12px 10px;border-bottom:1px solid #d7dfdc;text-align:left}}th{{background:#e3ebe7}}details{{margin:12px 0;background:white;padding:12px 18px}}summary{{cursor:pointer;font-weight:600}}code{{overflow-wrap:anywhere}}small{{color:#52666d}}</style>
<main><small>LOKALE PRACTICUMANALYSE · 16 OKTOBER 2026</small><h1>Welke methode volgt de markeringen beter?</h1>
<p>Alle <strong>{run['decoded_frames']} frames</strong> uit dezelfde opname zijn door beide methoden verwerkt. Voor de positiefout zijn vooraf 25 gelijkmatig verspreide frames en 6 extra moeilijke frames gekozen. De beelden en instellingen zijn tijdens de vergelijking niet aangepast.</p>
<div class="notice"><strong>Zo lees je deze test.</strong> De referentie bestaat uit twee afzonderlijke AI-visuele lezingen van de gekleurde markercentra, zonder detectoroverlays. De geschatte onzekerheid is {uncertainty_label} pixels. Kleine verschillen van dezelfde orde bepalen geen overtuigende winnaar. Grote missers en ontbrekende detecties zijn wel zichtbaar. Dit is geen gekalibreerde absolute nauwkeurigheidstest.</div>
<p>De mediane afstand tussen de twee lezingen is <strong>{fmt(float(np.median(agreement)))} px</strong>; P90 {fmt(float(np.percentile(agreement,90)))} px; maximum {fmt(float(np.max(agreement)))} px. {summary['paired_reference_count']} van de 62 markerposities zijn door beide lezingen als zichtbaar beoordeeld. De referentie is hun gemiddelde, zonder uitsluiting op grond van achteraf gevonden detectorfouten. Ontbrekende referenties staan in <a href="annotation-exclusions.csv">de uitsluitingen</a>.</p>
<img src="tracker-vergelijking.png" alt="Pixelafwijkingen en detectiedekking per methode en marker">
{''.join(tables)}
<p>Mediaan, P90 en RMSE gelden alleen voor beschikbare posities. De laatste twee kolommen tellen ontbrekende of afgekeurde posities mee als geen succes; hun noemer is alle 25 of 6 referentiepunten. Deze grenzen zijn een praktische vergelijking, geen gekalibreerde toleranties.</p>
<h2>Uitkomst voor dit filmpje</h2><p>Het oorspronkelijke rode-stipnotebook levert op {regular_original['within10px_count']} van {regular_original['reference_count']} verspreide oranje referentiepunten een positie binnen 10 pixels. De oorspronkelijke instellingen zijn bedoeld voor rood. Een verschil met de aangepaste variant is dus geen bewijs dat contourdetectie op zichzelf slechter is.</p>
<p>Met dezelfde kleuren en hetzelfde beeldgebied liggen de mediane afwijkingen van de notebookvariant en onze ruwe tracker tussen {fmt(min(regular_medians))} en {fmt(max(regular_medians))} pixels in de reguliere steekproef. Vergelijk dit met de geschatte referentieonzekerheid van {uncertainty_label} pixels. Bij onze ruwe oranje stressdetecties is gevonden: {miss_description}. De overlays en dekking laten zien wanneer een methode geen positie geeft of onze kwaliteitsselectie het hele markerpaar afkeurt.</p>
<p><strong>Praktische toepassing:</strong> gebruik de huidige tracker met kwaliteitscontrole en het aangepaste notebook als tweede controle. Kleine verschillen binnen de visuele referentieonzekerheid onderbouwen geen nauwkeurigheidsrangorde. Bekijk ontbrekende en afgekeurde frames voordat je snelheden of divergentie afleidt. De oorspronkelijke rode-stipinstellingen moeten eerst aan de werkelijke markerkleuren worden aangepast.</p>
<h2>Wat is precies vergeleken?</h2><ol>
<li><strong>Notebook origineel:</strong> de ongewijzigde functie voor één rode stip, met de oorspronkelijke HSV-grenzen, 5×5 opening/sluiting, grootste contour en integerzwaartepunt. Geen verzonnen groene uitkomst.</li>
<li><strong>Notebook met dezelfde kleuren:</strong> een expliciet aangepaste variant met de oranje/groene HSV-maskers en het beeldgebied van onze tracker. Alle overige contourstappen blijven gelijk. Dit scheidt kleuraanpassing van de keuze van detectiemethode.</li>
<li><strong>Onze tracker ruw:</strong> bestaande componentkeuze, kleurweging en geometrische grenzen. Op alle 2.492 frames zijn de oorspronkelijke posities en markeroppervlakken exact gereproduceerd.</li>
<li><strong>Onze tracker na selectie:</strong> dezelfde posities met de bestaande kwaliteitsselectie op het gehele markerpaar. Die selectie bevat ook de eerdere handmatige afkeuring van frame 385 en is dus niet volledig automatisch. Afkeuring kost dekking.</li></ol>
<p>Beide routes gebruiken OpenCV voor de beeldanalyse. FFmpeg/FFprobe verzorgen vooral videoverwerking en tijdstempels. Voor deze opname is <code>frame-index / 30</code> exact gelijk aan de oorspronkelijke tijdstempels. Dat geeft hier geen ruimtelijk voordeel aan één methode. De onbekende vertraging beïnvloedt fysieke snelheden, niet deze vergelijking in pixels.</p>
<h2>Alle controlebeelden</h2><p>De cirkels geven visuele onzekerheid aan, geen statistisch betrouwbaarheidsinterval. Open een beeld om detecties, ontbrekende punten en afkeuringen te inspecteren. Alle vooraf gekozen beelden staan hieronder.</p>{''.join(gallery)}
<h2>Betekenis voor het practicum</h2><p>De twee massa’s horen bij de staafjes: boven 0,2703 kg en onder 0,2000 kg, beide gemeld ±0,001 kg. De gele vierkantjes zijn volgmarkers, geen aparte puntmassa’s. Dit is in het practicumvoorbeeld verwerkt. De uniformiteit, traagheidsmomenten, markerposities, tijdschaal en demping moeten nog worden geijkt. Nauwkeurig een gekleurde stip volgen is niet automatisch hetzelfde als nauwkeurig een scharnierhoek meten.</p>
<p>Onze tracker was al op deze opname ingesteld. De steekproef is klein en bevat ook het vasthouden en het uitdempen van de opstelling. De zes extra beelden zijn bewust moeilijk en niet representatief voor de hele opname. Een algemeen oordeel vraagt nieuwe opnamen en handmatig gecontroleerde referentiepunten. De metingen geven op zichzelf geen betrouwbare Lyapunov-exponent.</p>
<h2>Controleerbare bestanden</h2><p><a href="accuracy-summary.json">Volledige scores en gepaarde vergelijkingen</a> · <a href="accuracy-by-frame.csv">Afwijking per frame</a> · <a href="predictions-selected-frames.csv">Alle geselecteerde detecties</a> · <a href="prediction-run.json">Reproductiecontrole</a> · <a href="timing-audit.json">Tijdstempelcontrole</a> · <a href="provenance-amendment.json">Aanvulling op vastgelegde herkomst</a> · <a href="tracker-vergelijking.svg">Grafiek als SVG</a></p>
<p><small>Deze HTML, videoafgeleide beelden, annotaties en meetbestanden blijven lokaal. Bronvideo en notebook zijn ongewijzigd.</small></p></main></html>'''
    (directory / 'vergelijking.html').write_text(report, encoding='utf-8')
    artifacts = ['vergelijking.html','tracker-vergelijking.png','tracker-vergelijking.svg']
    hashes = {name:hashlib.sha256((directory/name).read_bytes()).hexdigest() for name in artifacts}
    (directory/'report-artifacts.json').write_text(json.dumps(hashes,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'report':str(directory/'vergelijking.html'),'overlay_frames':len(gallery),'sha256':hashes},indent=2))


if __name__ == '__main__':
    main()
