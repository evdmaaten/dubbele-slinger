"""Quality flags, image-angle CSVs and a local report; never fits the simulator.

Usage: python analysis/report_video.py .local-data/video-analyse
Requires the outputs of track_video.py. Video time is the primary clock.
"""
import argparse
import base64
import csv
import hashlib
import json
import os
from pathlib import Path

import numpy as np


def mad(values):
    return float(1.4826 * np.nanmedian(np.abs(values - np.nanmedian(values))))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    directory = args.directory
    raw = directory / 'tracking-raw.csv'
    data = np.genfromtxt(raw, delimiter=',', names=True, encoding='utf-8')
    t = data['t_video_s']
    angles = np.column_stack([data['theta1_image_deg'], data['theta2_image_deg']])
    reasons = [[] for _ in t]
    def reject(mask, reason):
        for index in np.flatnonzero(mask):
            reasons[index].append(reason)
    reject(~np.isfinite(angles).all(axis=1), 'marker_missing')
    reject((data['orange_area_px'] <= 12) | (data['green_area_px'] <= 12), 'small_marker')
    reject((data['upper_marker_distance_px'] < 210) | (data['upper_marker_distance_px'] > 260)
           | (data['lower_marker_distance_px'] < 120) | (data['lower_marker_distance_px'] > 185), 'geometry_gate')
    reject(data['pivot_match'] < .72, 'pivot_match')
    reject((data['orange_threshold_shift_px'] > 5) | (data['green_threshold_shift_px'] > 5), 'threshold_sensitivity_gt5px')
    # Image review confirmed the orange component in frame 385 is a rod edge,
    # about 33 pixels from the actual dot. Keep this explicit in the audit trail.
    reject(data['frame'] == 385, 'visually_verified_wrong_orange_component')
    # The upper marker radius is almost constant in this recording. Use a
    # local image-space test, without constraining the variable lower radius.
    radius = data['upper_marker_distance_px']
    for index, value in enumerate(radius):
        window = radius[max(0,index-3):min(len(radius),index+4)]
        if np.isfinite(value) and np.isfinite(window).sum() >= 5:
            if abs(value - np.nanmedian(window)) > max(4., 6 * mad(window)):
                reasons[index].append('isolated_upper_radius_outlier')
    # Hampel screening: omit isolated local angle outliers, never replace them.
    # A 7-frame window is 0.2 playback seconds; high local motion widens the gate.
    for col in range(2):
        values = angles[:, col]
        for index, value in enumerate(values):
            window = values[max(0,index-3):min(len(values),index+4)]
            if np.isfinite(value) and np.isfinite(window).sum() >= 5:
                if abs(value - np.nanmedian(window)) > max(2.0, 6 * mad(window)):
                    reasons[index].append(f'isolated_angle{col+1}_outlier')
        # Conservative short zig-zag screen. Also rejects neighbours of some
        # bad detections; raw measurements remain available for later review.
        for index in range(1,len(t)-1):
            neighbours = values[index-1:index+2]
            if np.isfinite(neighbours).all():
                predicted = np.interp(t[index],t[[index-1,index+1]],values[[index-1,index+1]])
                if abs(values[index]-predicted) > 3.:
                    reasons[index].append(f'angle{col+1}_short_zigzag_gt3deg')
    good = np.array([not reason for reason in reasons])
    strict_available = np.isfinite(data['orange_threshold_shift_px']) & np.isfinite(data['green_threshold_shift_px'])
    unchecked_accepted = int((good & ~strict_available).sum())
    baseline = good & (t >= 10.5) & (t <= 11.8)
    initial = np.median(angles[baseline], axis=0)
    scatter = [mad(angles[baseline, i]) for i in range(2)]
    # Report a threshold crossing, not an unseen mechanical release.
    onsets = []
    for col in range(2):
        result = {}
        for threshold in [.5, 1., 2.]:
            beyond = good & (t >= 11.8) & (t < 15) & (np.abs(angles[:,col]-initial[col]) > threshold)
            found = None
            accepted = np.flatnonzero(good)
            for j, k in enumerate(accepted):
                group = accepted[j:j+5]
                # Five accepted measurements, at most one missing frame between.
                if len(group)==5 and beyond[group].all() and (np.diff(t[group]) <= .067).all():
                    earlier = accepted[:j]
                    below = earlier[np.abs(angles[earlier,col]-initial[col]) <= threshold]
                    found = [float(t[below[-1]]) if len(below) else None, float(t[k])]
                    break
            result[str(threshold)] = found
        onsets.append(result)
    gap_indices = np.flatnonzero(good)
    max_gap = float(np.max(np.diff(t[good])))
    summaries = {
        'status': 'Measured projected image angles; physical validation pending',
        'raw_csv_sha256': hashlib.sha256(raw.read_bytes()).hexdigest(),
        'total_frames': len(t), 'accepted_frames': int(good.sum()),
        'rejected_frames': int((~good).sum()), 'max_accepted_sample_gap_video_s': max_gap,
        'accepted_frames_without_strict_colour_check': unchecked_accepted,
        'time': {'primary': 'video playback seconds', 'playback_fps': 30,
                 'reported_acquisition_fps': 240, 'slowdown_factor_confirmed': False,
                 'scenario_only_factor': 8,
                 'condition': 'Only if every 240-fps acquisition frame is retained once and played at 30 fps; no temporal resampling.'},
        'angle_convention': 'Absolute angles of P-to-orange and orange-to-green from IMAGE downward axis; positive right. No perspective or camera-roll correction.',
        'baseline_window_video_s': [10.5, 11.8], 'baseline_frame_count': int(baseline.sum()),
        'initial_image_angles_deg': initial.tolist(), 'baseline_robust_scatter_deg': scatter,
        'scatter_note': 'Observed spread in the selected window, combining tracking variation and possible real motion. NOT total angle accuracy or a calibrated confidence interval.',
        'motion_threshold_crossings_video_s': onsets,
        'initial_angular_velocities': None,
        'quality_rules': 'Missing/small markers; broad pixel-distance gates; pivot correlation <0.72; strict-vs-normal colour centroid shift >5px; 7-frame Hampel angles (max(2deg,6 robust sigma)) and upper radius (max(4px,6 robust sigma)); angle deviation >3deg from linear interpolation of immediate neighbours (conservative, can omit neighbours of bad detections); visually confirmed wrong orange component in frame 385. Rejected values are omitted, never replaced.',
        'onset_rule': 'First of five consecutive accepted samples beyond baseline threshold, with gaps <=0.067 video seconds. Bracket starts at last accepted sample within the threshold before that run. This is a descriptive interval, not a release-time confidence interval.',
        'limitations': ['Physical time scale unconfirmed.', 'Marker centres and true hinge/rod axes not independently calibrated.',
                       'True vertical and perspective uncalibrated.',
                       'User-confirmed rod masses: upper 0.2703 kg and lower 0.2000 kg, each reported +/-0.001 kg; yellow cards are tracking markers, not separate point weights. Uniform density, centres of mass and moments of inertia remain model assumptions.',
                       'No shared mechanical release time or zero initial velocities inferred.',
                       'A decreasing oscillation envelope does not identify a friction law or demonstrate chaos.']}
    (directory/'measurement-summary.json').write_text(json.dumps(summaries,indent=2,allow_nan=False),encoding='utf-8')
    with (directory/'tracking-quality.csv').open('w',newline='',encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['frame','t_video_s','accepted','reason','strict_colour_check_available'])
        for k in range(len(t)):
            available = np.isfinite(data['orange_threshold_shift_px'][k]) and np.isfinite(data['green_threshold_shift_px'][k])
            writer.writerow([k,f'{t[k]:.6f}',int(good[k]),'|'.join(reasons[k]),int(available)])
    for filename, factor in [('hoeken-videotijd.csv',1),('hoeken-SCENARIO-8x.csv',8)]:
        with (directory/filename).open('w',newline='',encoding='utf-8') as f:
            f.write('# Voorlopige beeldhoeken; nul = beeld omlaag; positief = rechts; geen perspectiefcorrectie.\n')
            f.write('# Geen geinterpoleerde of vervangen meetpunten; ruwe data en kwaliteitsvlaggen apart bewaard.\n')
            f.write('# t = videotijd; fysieke tijdschaal ONBEKEND.\n' if factor == 1 else
                    '# SCENARIO ONBEVESTIGD: t = videotijd / 8; alleen bij 240 opname-fps naar 30 afspeel-fps zonder resampling.\n')
            writer = csv.writer(f)
            writer.writerow(['t','theta1_deg','theta2_deg','frame','t_video_s'])
            for k in gap_indices:
                writer.writerow([f'{t[k]/factor:.8f}',f'{angles[k,0]:.5f}',f'{angles[k,1]:.5f}',k,f'{t[k]:.6f}'])
    os.environ.setdefault('MPLCONFIGDIR',str((directory/'.matplotlib-cache').resolve()))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
    fig, axes = plt.subplots(2,1,figsize=(12,8),gridspec_kw={'height_ratios':[1.6,1]},layout='constrained')
    colors = ['#bb5825','#17765d']
    for i, name in enumerate(['Bovenste stang θ₁','Onderste stang θ₂']):
        measured = angles[:,i].copy()
        measured[~good] = np.nan
        axes[0].plot(t,measured,color=colors[i],lw=1,label=name)
        axes[1].scatter(t[good],angles[good,i],color=colors[i],s=13,label=name)
        axes[1].hlines(initial[i],10.5,11.8,color=colors[i],linestyle='--',lw=2)
    for axis in axes:
        axis.set_ylabel('Hoek in beeld (°)')
        axis.set_xlabel('Videotijd (s) · omzetting naar echte tijd nog onbekend')
        axis.grid(alpha=.18)
    axes[0].set_xlim(0,t[-1]); axes[0].legend(loc='upper right')
    axes[0].set_title('Gemeten beweging van de practicumopstelling',loc='left',fontsize=17,fontweight='bold',pad=14)
    axes[1].set_xlim(10.5,14); axes[1].set_ylim(-82,46)
    axes[1].axvspan(10.5,11.8,alpha=.07,color='#405367')
    axes[1].set_title(f'Beginstand: θ₁ ≈ {initial[0]:.1f}° · θ₂ ≈ {initial[1]:.1f}°',loc='left',pad=10)
    fig.savefig(directory/'gemeten-beweging.png',dpi=160)
    plt.close(fig)
    plot64 = base64.b64encode((directory/'gemeten-beweging.png').read_bytes()).decode()
    frame64 = base64.b64encode((directory/'track-frame-0330.jpg').read_bytes()).decode()
    html = f'''<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Videoanalyse dubbele slinger</title><style>body{{font:17px/1.6 system-ui,sans-serif;color:#23343c;background:#f4f6f5;margin:0}}main{{max-width:1000px;margin:auto;padding:32px}}h1{{line-height:1.15;font-size:38px}}h2{{font-size:23px;margin-top:32px}}img{{width:100%;border-radius:12px}}.box{{background:white;border-radius:16px;padding:24px;margin:20px 0}}.note{{border-left:4px solid #bc632d;padding-left:18px}}table{{border-collapse:collapse;width:100%}}th,td{{padding:10px;border-bottom:1px solid #dce4e2;text-align:left}}a{{color:#136b5c}}code{{overflow-wrap:anywhere}}small{{color:#53646d}}</style>
<main><small>Practicum · lokale videoanalyse · 15 oktober 2026</small><h1>De echte beweging in beeld</h1>
<p>De gekleurde markeringen zijn per videobeeld gevolgd. Dit levert een gemeten hoekverloop op voor een latere vergelijking met het model.</p>
<div class="box"><table><tr><th>Voorlopige beginstand</th><th>Hoek vanaf beeld omlaag</th></tr><tr><td>Bovenste stang θ₁</td><td><b>{initial[0]:.1f}°</b> · naar rechts</td></tr><tr><td>Onderste stang θ₂</td><td><b>{initial[1]:.1f}°</b> · naar links</td></tr></table>
<p>Beide zijn absolute hoeken; θ₂ is dus niet de hoek ten opzichte van de bovenste stang. De beginstand is de mediaan over 10,5–11,8 seconden videotijd ({int(baseline.sum())} meetpunten). De waargenomen spreiding in dat venster is ongeveer {scatter[0]:.2f}° en {scatter[1]:.2f}°; hierin zitten trackingvariatie en mogelijk echte kleine beweging. Dit is geen totale hoeknauwkeurigheid. Perspectief, camerahelling en de plaats van de markeringen kunnen een grotere systematische fout geven.</p></div>
<p class="note"><b>De echte tijdschaal staat nog niet vast.</b> Het ontvangen bestand heeft 30 beelden per afspeelseconde. Er is 240 fps als opnamesnelheid genoemd, maar de vertraging is niet bevestigd. Alleen als alle opnamebeelden een-op-een behouden zijn, geldt echte tijd = videotijd / 8. Die omzetting staat uitsluitend in een apart scenariobestand.</p>
<img src="data:image/png;base64,{plot64}" alt="Gemeten hoeken over de videotijd en detail van het bewegingsbegin">
<h2>Wat is zichtbaar?</h2><p>De onderste stang vertrekt rond 11,9–12,1 seconden videotijd uit de beginstand. De bovenste stang verandert rond 12,8–12,9 seconden duidelijk van hoek. Dit zijn detecteerbare hoekveranderingen, geen direct waargenomen loslaatmomenten. Een gezamenlijk loslaatmoment en beide beginsnelheden nul zijn daarom nog niet vastgesteld.</p>
<p>De onderste stang maakt eerst grote uitslagen die later afnemen. Herhalingsintervallen veranderen daarbij. Dat patroon op zichzelf bewijst geen chaos en bepaalt nog geen wrijvingscoëfficiënt.</p>
<h2>Controle van de herkenning</h2><img src="data:image/jpeg;base64,{frame64}" alt="Beeld op 11 seconden met herkende draaipunt- en markeerposities"><p><b>P</b> = bovenste draaipunt, <b>O</b> = oranje stip, <b>G</b> = groene stip. De witte lijnen zijn de gebruikte meetrichtingen. <b>B</b> is een achtergrondreferentie voor controle; deze is niet gebruikt om de hoeken te corrigeren.</p>
<p>{int(good.sum())} van {len(t)} beelden zijn opgenomen in de meet-CSV ({100*good.mean():.1f}%). Ontbrekende detecties, onzekere kleurherkenning en geïsoleerde uitschieters zijn weggelaten, niet door voorspellingen vervangen. Dit is een automatische kwaliteitsselectie met steekproefsgewijze beeldcontrole; zij garandeert niet dat elk overgebleven punt correct is. De grootste afstand tussen overgebleven meetpunten is {max_gap:.3f} videoseconde. Ruwe posities en afkeurreden per beeld blijven bewaard.</p>
<p>Bij {unchecked_accepted} opgenomen beelden ({100*unchecked_accepted/good.sum():.1f}%) was de strengere kleurcontrole niet voor beide stippen beschikbaar. Die punten zijn behouden op basis van de overige criteria en in het kwaliteitsbestand herkenbaar; een ontbrekende controle geldt niet als een geslaagde controle.</p>
<h2>Bestanden gebruiken</h2><ol><li>Bewaar <b>hoeken-videotijd.csv</b> als primaire meting. De kolom <code>t</code> bevat afspeelseconden vanaf het begin van de video.</li><li>De simulator kan de CSV via de meetgegevensimport openen. Voor vergelijking met een simulatie in echte seconden moet eerst de videofactor worden bevestigd. De hoekreferentie moet ook nog aan de echte verticale richting worden gekoppeld.</li><li><b>hoeken-SCENARIO-8x.csv</b> bevat dezelfde hoeken met de tijd gedeeld door 8. Gebruik dit alleen als expliciet scenario; het is geen bevestigde kalibratie.</li><li>Kies daarna een gezamenlijk starttijdstip en bepaal beide hoeken én hoeksnelheden op dat tijdstip. De beginstand bovenaan is nog geen volledige begintoestand voor een vrij bewegend model.</li></ol>
<h2>Nodig voor een eerlijke modelvergelijking</h2><p>De lengtes 203 mm en 157 mm zijn bekend. Op 16 oktober 2026 is bevestigd dat de massa’s 0,2703 kg en 0,2000 kg (beide gemeld ±0,001 kg) bij respectievelijk de bovenste en onderste staaf horen. De gele vierkantjes zijn volgmarkers, geen aparte puntgewichten; in het model geldt m₁ = m₂ = 0 naast deze stangmassa’s. Uniformiteit, zwaartepunten en traagheidsmomenten zijn daarmee nog niet vastgesteld. Ook wrijving, fysieke tijdschaal en markergeometrie blijven te kalibreren. De groene stip ligt vóór het fysieke uiteinde; de afstand tussen de stippen mag daarom niet automatisch gelijk aan 157 mm worden gesteld.</p>
<p>De hoeken zijn gemeten in het camerabeeld, zonder perspectiefcorrectie. Het bovenste draaipunt wordt per beeld gevolgd om beeldverschuiving op te vangen. Camerahelling en perspectief zijn niet gekalibreerd. De meting gebruikt geen voorspelde simulatiebaan.</p>
<small>Bronvideo blijft lokaal. Metadatabestand bevat de SHA-256-controlesom, meetconventies en beperkingen. Deze analyse is een meetbasis; de fysieke simulatie is hiermee nog niet gevalideerd.</small></main></html>'''
    (directory/'videoanalyse.html').write_text(html,encoding='utf-8')
    print(json.dumps(summaries,indent=2,allow_nan=False))


if __name__ == '__main__':
    main()
