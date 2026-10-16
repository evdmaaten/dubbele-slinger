"""Local, reproducible marker tracking for the supplied practicum recording.

Coordinates here are pixels, x right/y down. No masses, simulation dynamics or
predicted trajectory are used to track markers. The two static reference patches
are inspected manually; colour masks detect each marker independently per frame.
The raw results are retained, including failed detections and confidence scores.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


def marker(hsv, kind, strict=False, reference=None, distance_bounds=None):
    h, s, v = cv2.split(hsv)
    if kind == 'green':
        mask = (h >= (32 if strict else 29)) & (h <= 95) & (s > (100 if strict else 70)) & (v > 40)
    else:
        mask = (h <= (16 if strict else 18)) & (s > (180 if strict else 155)) & (v > 75)
    mask[:30] = False
    mask[550:] = False
    mask[:, :180] = False
    mask[:, 850:] = False
    n, labels, stats, centers = cv2.connectedComponentsWithStats(mask.astype('uint8'), 8)
    candidates = [i for i in range(1, n) if 12 <= stats[i, cv2.CC_STAT_AREA] <= 1400
                  and stats[i, cv2.CC_STAT_WIDTH] < 70 and stats[i, cv2.CC_STAT_HEIGHT] < 70]
    if reference is not None:
        candidates = [i for i in candidates if distance_bounds[0] <= np.linalg.norm(centers[i]-reference) <= distance_bounds[1]]
    if not candidates:
        return np.full(2, np.nan), 0
    def score(k):
        hue = float(np.median(h[labels == k]))
        contrast = max(hue-25, 1) if kind == 'green' else max(23-hue, 1)
        return stats[k, cv2.CC_STAT_AREA] * contrast**2
    i = max(candidates, key=score)
    return centers[i], int(stats[i, cv2.CC_STAT_AREA])


def match_patch(gray, template, nominal, radius=20):
    half = template.shape[0] // 2
    x, y = map(int, nominal)
    left, top = x - half - radius, y - half - radius
    roi = gray[top:y + half + radius + 1, left:x + half + radius + 1]
    score = cv2.matchTemplate(roi, template, cv2.TM_CCOEFF_NORMED)
    _, peak, _, loc = cv2.minMaxLoc(score)
    px, py = loc
    offset = []
    # Quadratic peak refinement, bounded to one pixel.
    for d in [(0, 1), (1, 0)]:
        dx, dy = d
        if 0 < px < score.shape[1] - 1 and 0 < py < score.shape[0] - 1:
            a, b, c = score[py-dy, px-dx], score[py, px], score[py+dy, px+dx]
            den = a - 2*b + c
            offset.append(float(np.clip(.5*(a-c)/den, -.75, .75)) if abs(den) > 1e-8 else 0.)
        else:
            offset.append(0.)
    # The first direction is vertical and the second is horizontal.
    return np.array([left + px + half + offset[1], top + py + half + offset[0]]), float(peak)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('video', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,nb_frames,avg_frame_rate:frame=best_effort_timestamp_time',
        '-of', 'json', str(args.video)], text=True))
    times = [float(f['best_effort_timestamp_time']) for f in metadata['frames']]
    cv2.setNumThreads(1)
    cap = cv2.VideoCapture(str(args.video))
    ok, first = cap.read()
    if not ok:
        raise RuntimeError('Cannot decode input video')
    if first.shape[:2] != (576, 1024):
        raise ValueError('Reference patches are specific to the inspected 1024x576 recording')
    gray0 = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
    pivot0 = np.array([504., 74.])
    screw0 = np.array([688., 224.])
    templates = []
    for point, half in [(pivot0, 10), (screw0, 9)]:
        x, y = point.astype(int)
        templates.append(gray0[y-half:y+half+1, x-half:x+half+1].copy())
    ref = screw0-pivot0
    ref_angle = np.arctan2(ref[1], ref[0])
    rows = []
    annotated = []
    checkpoints = {0, 330, 360, 375, 390, 405, 420, 450, 600, 900, 1200, 1800, 2400, 2491}
    frame = first
    i = 0
    while frame is not None:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        pivot, pc = match_patch(gray, templates[0], pivot0)
        screw, sc = match_patch(gray, templates[1], screw0)
        # Broad image-space gates exclude the OTHER yellow card and background.
        # They do not use a simulated trajectory or the supplied metric lengths.
        orange, oa = marker(hsv, 'orange', reference=pivot, distance_bounds=(210,260))
        green, ga = marker(hsv, 'green', reference=orange, distance_bounds=(120,185))
        orange_strict, _ = marker(hsv, 'orange', True, pivot, (210,260))
        green_strict, _ = marker(hsv, 'green', True, orange, (120,185))
        delta = screw-pivot
        rotation = np.arctan2(delta[1], delta[0])-ref_angle
        scale = np.linalg.norm(delta)/np.linalg.norm(ref)
        cs, sn = np.cos(rotation), np.sin(rotation)
        matrix = np.array([[cs, sn], [-sn, cs]])/scale
        o = matrix@(orange-pivot)
        g = matrix@(green-pivot)
        v1, v2 = orange-pivot, green-orange
        angles = np.degrees([np.arctan2(v1[0], v1[1]), np.arctan2(v2[0], v2[1])])
        row = {'frame': i, 't_video_s': times[i], 'pivot_x_px': pivot[0], 'pivot_y_px': pivot[1],
            'screw_x_px': screw[0], 'screw_y_px': screw[1], 'pivot_match': pc, 'screw_match': sc,
            'camera_rotation_deg': np.degrees(rotation), 'camera_scale': scale,
            'orange_x_px': orange[0], 'orange_y_px': orange[1], 'green_x_px': green[0], 'green_y_px': green[1],
            'orange_area_px': oa, 'green_area_px': ga,
            'orange_threshold_shift_px': np.linalg.norm(orange-orange_strict),
            'green_threshold_shift_px': np.linalg.norm(green-green_strict),
            'orange_stabilized_x_px': o[0], 'orange_stabilized_y_px': o[1],
            'green_stabilized_x_px': g[0], 'green_stabilized_y_px': g[1],
            'theta1_image_deg': angles[0], 'theta2_image_deg': angles[1],
            'upper_marker_distance_px': np.linalg.norm(v1), 'lower_marker_distance_px': np.linalg.norm(v2)}
        rows.append(row)
        if i in checkpoints:
            show = frame.copy()
            points = [pivot, orange, green, screw]
            for pt, color, name in zip(points, [(255,255,255),(20,110,255),(70,220,70),(255,200,50)], ['P','O','G','B']):
                if np.all(np.isfinite(pt)):
                    p = tuple(np.round(pt).astype(int))
                    cv2.drawMarker(show,p,color,cv2.MARKER_CROSS,18,2)
                    cv2.putText(show,name,(p[0]+12,p[1]-10),cv2.FONT_HERSHEY_SIMPLEX,.5,color,1,cv2.LINE_AA)
            for a,b in [(pivot,orange),(orange,green)]:
                if np.all(np.isfinite([a,b])):
                    cv2.line(show,tuple(a.astype(int)),tuple(b.astype(int)),(240,240,240),1,cv2.LINE_AA)
            cv2.putText(show,f'frame {i} | t={times[i]:.3f} s | image angles {angles[0]:.1f}, {angles[1]:.1f} deg',
                (20,550),cv2.FONT_HERSHEY_SIMPLEX,.55,(255,255,255),1,cv2.LINE_AA)
            name = f'track-frame-{i:04d}.jpg'
            cv2.imwrite(str(args.output/name),show)
            annotated.append(name)
        ok, frame = cap.read()
        if not ok:
            frame = None
        i += 1
        if i % 300 == 0:
            print(f'Tracked {i}/{len(times)} frames', flush=True)
    cap.release()
    if len(rows) != len(times):
        raise RuntimeError(f'Decoded {len(rows)} frames but timestamp count {len(times)}')
    with (args.output/'tracking-raw.csv').open('w',newline='',encoding='utf-8') as f:
        writer = csv.DictWriter(f,fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    summary = {'video':args.video.name,'sha256':hashlib.file_digest(args.video.open('rb'),'sha256').hexdigest(),
        'frames':len(rows),'firstTimestamp':times[0],'lastTimestamp':times[-1],
        'timestampDeltaRange': [min(np.diff(times)),max(np.diff(times))],
        'nominalPivotPixel':pivot0.tolist(),'nominalStaticScrewPixel':screw0.tolist(),
        'cameraCorrection':'Per-frame pivot removes image translation. Similarity reference values are diagnostic only: unreliable screw patches are NOT used to correct angles. No roll or perspective rectification.',
        'annotatedFrames':annotated,'cv2Version':cv2.__version__,'numpyVersion':np.__version__}
    (args.output/'tracking-metadata.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary,indent=2))
    for field in ['pivot_match','screw_match','orange_area_px','green_area_px','camera_rotation_deg','camera_scale',
                  'upper_marker_distance_px','lower_marker_distance_px','orange_threshold_shift_px','green_threshold_shift_px']:
        v=np.array([r[field] for r in rows])
        print(field, np.nanpercentile(v,[0,1,50,99,100]).tolist(), 'nonfinite',int(np.sum(~np.isfinite(v))))


if __name__ == '__main__':
    main()
