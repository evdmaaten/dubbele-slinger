"""Render measured marker paths, using existing quality flags; no new tracking.

The video remains on its 30fps playback clock. Historical positions are shifted
by the measured pivot translation into the current frame. No scale, camera roll,
perspective or physical mass-centre correction is applied.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


COLORS = [(35, 145, 255), (115, 245, 70)]  # OpenCV BGR
NAMES = ['1  Oranje markering', '2  Groene markering']


def label(frame, text, xy, size=.52, color=(230, 235, 240), thickness=1):
    cv2.putText(frame, text, xy, cv2.FONT_HERSHEY_SIMPLEX, size, color, thickness, cv2.LINE_AA)


def write_path_csv(directory, raw, good):
    """Keep every source frame and explicit gaps for the HTML XY comparison."""
    with (directory/'bewegingspaden.csv').open('w',newline='',encoding='utf-8') as f:
        f.write('# Gemeten markeringen, geen massamiddelpunten. Videotijd; echte tijdschaal onbekend.\n')
        f.write('# Posities relatief aan gevolgd bovenste draaipunt; beeldpixels; x rechts, y omlaag.\n')
        f.write('# valid=0: afgekeurd meetpaar, geen verbinding over dit frame.\n')
        writer=csv.writer(f)
        writer.writerow(['t_video_s','frame','valid','x1_px','y1_px','x2_px','y2_px'])
        for i,row in enumerate(raw):
            xy=[]
            for marker in ['orange','green']:
                xy.extend([f"{row[f'{marker}_x_px']-row['pivot_x_px']:.5f}",
                           f"{row[f'{marker}_y_px']-row['pivot_y_px']:.5f}"] if good[i] else ['',''])
            writer.writerow([f"{row['t_video_s']:.6f}",i,int(good[i]),*xy])


def draw_complete_paths(directory, relative, good):
    """Draw the full measured paths without reading or rendering the video."""
    import os
    directory = Path(directory)
    os.environ.setdefault('MPLCONFIGDIR',str((directory/'.matplotlib-cache').resolve()))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,ax=plt.subplots(figsize=(10.5,9))
    # Reserve separate space for the legend and for the two-line footer. The
    # equal aspect ratio preserves pixel geometry without hiding the pivot.
    fig.subplots_adjust(left=.10,right=.64,bottom=.18,top=.87)
    for marker,color in enumerate(['#cf6218','#168c55']):
        points=relative[marker].copy()
        points[~good]=np.nan
        ax.plot(points[:,0],points[:,1],color=color,lw=1.1,alpha=.8,label=['Oranje markering (boven)','Groene markering (onder)'][marker])
        ax.scatter(*relative[marker][0],s=55,color=color,edgecolors='white',zorder=4)
    ax.scatter(0,0,s=75,marker='+',color='#243641',label='Bovenste draaipunt',zorder=4)
    ax.axvline(0,lw=.7,color='#abb6bc',alpha=.5)
    ax.set_aspect('equal',adjustable='box');ax.invert_yaxis()
    ax.set_xlabel('x ten opzichte van bovenste draaipunt\n(beeldpixels)',labelpad=9)
    ax.set_ylabel('y naar beneden (beeldpixels)',labelpad=9)
    fig.suptitle('Gemeten paden over de volledige opname',x=.07,y=.965,ha='left',fontsize=17)
    ax.legend(loc='upper left',bbox_to_anchor=(1.05,1),borderaxespad=0,frameon=False)
    ax.grid(alpha=.18)
    fig.text(.07,.045,'Alleen beeldverschuiving gecorrigeerd; geen perspectief- of schaalcorrectie.\nGaten blijven open.',ha='left',va='bottom',fontsize=10,linespacing=1.5)
    output=directory/'volledige-bewegingspaden.png'
    fig.savefig(output,dpi=160)
    plt.close(fig)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('video', type=Path)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--trail-seconds', type=float, default=8.)
    args = parser.parse_args()
    if not 0 < args.trail_seconds <= 90:
        raise ValueError('Trail duration must be in (0,90] video seconds')
    directory = args.directory
    metadata = json.loads((directory/'tracking-metadata.json').read_text())
    with args.video.open('rb') as source:
        source_hash = hashlib.file_digest(source,'sha256').hexdigest()
    if source_hash != metadata['sha256']:
        raise ValueError('Tracking does not belong to this source video')
    raw = np.genfromtxt(directory/'tracking-raw.csv',delimiter=',',names=True,encoding='utf-8')
    with (directory/'tracking-quality.csv').open(encoding='utf-8') as f:
        quality = list(csv.DictReader(f))
    if len(raw) != len(quality) or any(int(q['frame'])!=i for i,q in enumerate(quality)):
        raise ValueError('Quality rows do not match source frames')
    good = np.array([q['accepted']=='1' for q in quality])
    write_path_csv(directory,raw,good)
    t = raw['t_video_s']
    fps = 30
    if not np.allclose(np.diff(t),1/fps,atol=1e-6):
        raise ValueError('This renderer requires the verified constant 30fps timestamps')
    pivots = np.column_stack([raw['pivot_x_px'],raw['pivot_y_px']])
    positions = [np.column_stack([raw[f'{name}_x_px'],raw[f'{name}_y_px']]) for name in ['orange','green']]
    relative = [p-pivots for p in positions]
    if not np.isfinite(pivots).all() or not all(np.isfinite(p[good]).all() for p in positions):
        raise ValueError('Non-finite accepted marker or reference coordinates')
    output = directory/'practicum-met-bewegingssporen.mp4'
    log = directory/'trail-render-ffmpeg.log'
    cap = cv2.VideoCapture(str(args.video))
    cv2.setNumThreads(1)
    width,height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if (width,height)!=(1024,576):
        raise ValueError('Unexpected video dimensions')
    top,bottom = 74,50
    command = ['ffmpeg','-hide_banner','-loglevel','warning','-y',
               '-f','rawvideo','-pix_fmt','bgr24','-s',f'{width}x{height+top+bottom}',
               '-r',str(fps),'-i','pipe:0','-i',str(args.video),
               '-map','0:v:0','-map','1:a:0?','-c:v','libx264','-preset','fast','-crf','20',
               '-pix_fmt','yuv420p','-c:a','copy','-shortest','-movflags','+faststart',str(output)]
    snapshots = {450,600,900,1800}
    with log.open('wb') as log_file:
        encoder = subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log_file)
        try:
            for i in range(len(raw)):
                ok,frame = cap.read()
                if not ok:
                    raise RuntimeError(f'Video ended at frame {i}')
                start = int(np.searchsorted(t,t[i]-args.trail_seconds,side='left'))
                for marker,color in enumerate(COLORS):
                    for k in range(max(1,start),i+1):
                        if not (good[k-1] and good[k]) or k-1 < start:
                            continue  # No line across rejected samples.
                        a,b = np.rint(relative[marker][[k-1,k]]+pivots[i]).astype(int)
                        brightness = .25+.75*max(0.,1-(t[i]-t[k])/args.trail_seconds)
                        faded = tuple(int(c*brightness) for c in color)
                        cv2.line(frame,tuple(a),tuple(b),faded,2,cv2.LINE_AA)
                    if good[i]:
                        point = tuple(np.rint(positions[marker][i]).astype(int))
                        cv2.circle(frame,point,11,(20,25,30),4,cv2.LINE_AA)
                        cv2.circle(frame,point,11,color,2,cv2.LINE_AA)
                        label(frame,str(marker+1),(point[0]+16,point[1]-12),.5,color,2)
                canvas = np.full((height+top+bottom,width,3),(35,29,23),dtype='uint8')
                canvas[top:top+height] = frame
                label(canvas,'GEMETEN BEWEGING | DUBBELE SLINGER',(24,29),.72,(245,246,248),2)
                for marker in range(2):
                    x = 25+marker*300
                    cv2.line(canvas,(x,54),(x+32,54),COLORS[marker],3,cv2.LINE_AA)
                    label(canvas,NAMES[marker],(x+43,59),.51,COLORS[marker])
                label(canvas,f'Videotijd  {t[i]:05.2f} s',(778,29),.55,(230,235,240),1)
                label(canvas,f'Spoor: laatste {args.trail_seconds:g} s (video)',(730,59),.46)
                label(canvas,'Gevolgde stippen; geen bepaalde massamiddelpunten. Echte tijdschaal nog onbekend.',(24,height+top+21),.48)
                status = 'Sporen onderbroken bij afgekeurde detecties.' if good[i] else 'Dit beeld: detectie afgekeurd; geen nieuw meetpunt.'
                label(canvas,status,(24,height+top+42),.46,(180,195,210) if good[i] else (80,180,255))
                encoder.stdin.write(canvas.tobytes())
                if i in snapshots:
                    cv2.imwrite(str(directory/f'spoorcontrole-{i:04d}.jpg'),canvas)
                if i % 500 == 0:
                    print(f'Rendered {i}/{len(raw)} frames',flush=True)
            if cap.read()[0]:
                raise RuntimeError('Source has more frames than tracking')
        finally:
            cap.release()
            encoder.stdin.close()
            result = encoder.wait()
        if result:
            raise RuntimeError(f'FFmpeg failed: see {log}')
    # A complete spatial path, independent of the 8-second tail length.
    draw_complete_paths(directory,relative,good)
    manifest = {'source_sha256':source_hash,'raw_tracking_sha256':hashlib.sha256((directory/'tracking-raw.csv').read_bytes()).hexdigest(),
                'quality_sha256':hashlib.sha256((directory/'tracking-quality.csv').read_bytes()).hexdigest(),
                'frames':len(raw),'accepted_pairs':int(good.sum()),'playback_fps':fps,'trail_video_seconds':args.trail_seconds,
                'output':output.name,'audio':'Original AAC stream copied without speed change',
                'semantics':'Measured marker centres, not identified mass centres. Historical positions translated by current minus historical pivot position. No connection across rejected source frames. No time conversion, roll/scale/perspective correction, or simulation fitting.'}
    (directory/'trail-render-metadata.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps(manifest,indent=2),flush=True)


if __name__=='__main__':
    main()
