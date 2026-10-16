"""Export a predeclared, detector-blind frame sample for visual reference labels."""
import argparse
import hashlib
import json
import os
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument('video', type=Path)
    p.add_argument('output', type=Path)
    args = p.parse_args()
    regular = [round(i * 2491 / 24) for i in range(25)]
    stress = [360, 375, 385, 405, 420, 450]
    frames = sorted(set(regular + stress))
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('MPLCONFIGDIR', str(args.output / '.matplotlib-cache'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    for name in ['reference-frames', 'reference-grids']:
        (args.output / name).mkdir(exist_ok=True)
    manifest = {'source_sha256': hashlib.sha256(args.video.read_bytes()).hexdigest(),
                'regular_frames': regular, 'stress_frames': stress,
                'stress_note': 'Extra cases from the previously inspected onset, including a known tracking difficulty. Report separately, not a representative sample.',
                'reference': 'Two independent AI visual readings of the visible orange and green marker centres, not calibrated human ground truth.',
                'coordinates': 'Original pixels, x right and y down, origin at upper left.',
                'predeclared_error_thresholds_px': [5, 10],
                'selection': '25 uniformly spaced source frame indices over all 2492 frames; 6 separately reported onset stress frames.'}
    (args.output / 'reference-protocol.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    cap = cv2.VideoCapture(str(args.video))
    index = 0
    extracted = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if index in frames:
            if frame.shape[:2] != (576, 1024):
                raise ValueError('Reference sample is specific to the supplied 1024x576 video.')
            name = f'frame-{index:04d}.png'
            cv2.imwrite(str(args.output / 'reference-frames' / name), frame)
            fig, ax = plt.subplots(figsize=(12.8, 10), dpi=120)
            ax.imshow(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), origin='upper')
            ax.set_xlim(180, 850); ax.set_ylim(550, 30)
            ax.set_xticks(np.arange(180, 851, 40)); ax.set_yticks(np.arange(30, 551, 40))
            ax.set_xticks(np.arange(180, 851, 10), minor=True)
            ax.set_yticks(np.arange(30, 551, 10), minor=True)
            ax.grid(which='major', color='white', alpha=.35, linewidth=.65)
            ax.grid(which='minor', color='white', alpha=.18, linewidth=.4)
            ax.set_xlabel('x in original pixels'); ax.set_ylabel('y in original pixels (down)')
            ax.set_title(f'Blind reference · frame {index} · no detector overlay')
            fig.tight_layout()
            fig.savefig(args.output / 'reference-grids' / name)
            plt.close(fig)
            extracted.append(index)
        index += 1
    cap.release()
    if extracted != frames or index != 2492:
        raise ValueError(f'Unexpected decoded frame set/count: {len(extracted)}, {index}')
    if hashlib.sha256(args.video.read_bytes()).hexdigest() != manifest['source_sha256']:
        raise ValueError('Source hash changed')
    print(json.dumps({'frames':len(extracted),'source_frames':index,'output':str(args.output)}))


if __name__ == '__main__':
    main()
