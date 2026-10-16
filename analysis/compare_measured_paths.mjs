/** Conditional forward comparison using the same physics as the HTML app.
 * No tuning of mechanics, time factor or projection against future frames.
 * Usage: node analysis/compare_measured_paths.mjs [tracking-directory] [output-directory]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { simulate, compareConvergence } from '../physics.js';
import { parsePathCSV, makePathComparison } from '../paths.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.resolve(process.argv[2] || path.join(root, '.local-data/video-analyse'));
const output = path.resolve(process.argv[3] || path.join(root, '.local-data/model-vergelijking'));
await mkdir(output, {recursive:true});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(path.join(input,'bewegingspaden.csv'));
const measured = parsePathCSV(source.toString('utf8'));
const massBytes = await readFile(path.join(root,'practicum-gegevens.json'));
const massRecord = JSON.parse(massBytes);
const s1 = massRecord.lengths.s1.value, s2 = massRecord.lengths.s2.value;
const rodMass1 = massRecord.masses.upper.value, rodMass2 = massRecord.masses.lower.value;
if(massRecord.masses.upper.modelParameter!=='rodMass1' || massRecord.masses.lower.modelParameter!=='rodMass2') throw Error('Confirmed rod-mass assignment required.');
const RAD=Math.PI/180, DEG=180/Math.PI;
const start=13.5, end=53.5, scoreStart=13.7;
const windows=[{id:'first',start:scoreStart,end:15.5},{id:'short',start:scoreStart,end:21.5},{id:'long',start:scoreStart,end}, {id:'later',start:21.5,end}];
const wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
const median=values=>quantile(values,.5);
function quantile(values,q){const a=[...values].sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*q;return a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i%1);}
function stats(values){return {count:values.length,rmse:Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length),median:median(values),p95:quantile(values,.95),max:Math.max(...values)};}
function rawAngles(row){return [Math.atan2(row.x1,row.y1), Math.atan2(row.x2-row.x1,row.y2-row.y1)];}
const baseline=measured.filter(r=>r.valid&&r.t>=10.5&&r.t<=11.8);
if(baseline.length<20)throw Error('Insufficient baseline for provisional projection.');
const upperRadius=median(baseline.map(r=>Math.hypot(r.x1,r.y1)));
const lowerRadius=median(baseline.map(r=>Math.hypot(r.x2-r.x1,r.y2-r.y1)));
const pixelsPerMeter=upperRadius/s1;
const marker2Fraction=lowerRadius/(pixelsPerMeter*s2);
const projection={pixelsPerMeter,marker1Fraction:1,marker2Fraction,cameraRollDeg:0,
  baselineVideo:[10.5,11.8],baselineCount:baseline.length,upperRadiusPx:upperRadius,lowerRadiusPx:lowerRadius,
  assumptions:['Orange centre is the intermediate hinge.','Constant isotropic image scale inferred from upper rod length.','Green fraction inferred from held baseline, not measured independently.','Image down is assumed to be gravity down; no perspective correction.'],
  status:'PROVISIONAL IMAGE PROJECTION, not physical spatial calibration'};
function initialState(halfFrames){
  const rows=measured.filter(r=>r.valid&&Math.abs(r.frame-405)<=halfFrames);
  if(rows.length!==2*halfFrames+1||rows.some((r,i)=>r.frame!==405-halfFrames+i))throw Error('Initial-state window must contain complete consecutive valid frames.');
  const t=rows.map(r=>r.t-start), meanT=t.reduce((a,b)=>a+b,0)/t.length;
  const fits=[0,1].map(marker=>{
    const a=rows.map(r=>rawAngles(r)[marker]);
    for(let i=1;i<a.length;i++)a[i]=a[i-1]+wrap(a[i]-a[i-1]);
    const meanA=a.reduce((s,v)=>s+v,0)/a.length;
    const slope=t.reduce((s,x,i)=>s+(x-meanT)*(a[i]-meanA),0)/t.reduce((s,x)=>s+(x-meanT)**2,0);
    const intercept=meanA-slope*meanT;
    return {angleDeg:intercept*DEG,slopeDegPerVideoSecond:slope*DEG,residualRmsDeg:Math.sqrt(a.reduce((s,v,i)=>s+(v-intercept-slope*t[i])**2,0)/a.length)*DEG};
  });
  return {frameCount:rows.length,firstFrame:rows[0].frame,lastFrame:rows.at(-1).frame,videoWindow:[rows[0].t,rows.at(-1).t],fits,
    method:'Local linear regression of unwrapped image angles. Slopes multiplied by scenario time factor; no rest-release assumption.'};
}
const initial7=initialState(3), initial11=initialState(5);
const definitions=[
  {id:'f8-free',label:'8× vertraging · zonder demping',factor:8,c1:0,c2:0,initial:initial7},
  {id:'f1-free',label:'Normale snelheid · zonder demping',factor:1,c1:0,c2:0,initial:initial7},
  {id:'f8-example-damping',label:'8× vertraging · voorbeelddemping',factor:8,c1:.002,c2:.001,initial:initial7},
  {id:'f1-example-damping',label:'Normale snelheid · voorbeelddemping',factor:1,c1:.002,c2:.001,initial:initial7},
  {id:'f8-init11',label:'8× vertraging · 11 startframes',factor:8,c1:0,c2:0,initial:initial11},
];
const predictionRows=[];
const scenarios=[];
function interpolate(samples,t){
  let low=0,high=samples.length-1;
  while(high-low>1){const m=(low+high)>>1;if(samples[m].t<=t)low=m;else high=m;}
  const a=samples[low],b=samples[high], f=(t-a.t)/(b.t-a.t);
  return {theta1:a.theta1+f*(b.theta1-a.theta1),theta2:a.theta2+f*(b.theta2-a.theta2)};
}
function projected(a,b){return {x1:pixelsPerMeter*s1*Math.sin(a),y1:pixelsPerMeter*s1*Math.cos(a),
  x2:pixelsPerMeter*(s1*Math.sin(a)+marker2Fraction*s2*Math.sin(b)),
  y2:pixelsPerMeter*(s1*Math.cos(a)+marker2Fraction*s2*Math.cos(b))};}
for(const def of definitions){
  const params={model:'rigid',s1,s2,rodMass1,rodMass2,m1:0,m2:0,g:9.81,c1:def.c1,c2:def.c2,
    theta1:def.initial.fits[0].angleDeg,theta2:def.initial.fits[1].angleDeg,
    omega1:def.factor*def.initial.fits[0].slopeDegPerVideoSecond,omega2:def.factor*def.initial.fits[1].slopeDegPerVideoSecond,
    duration:(end-start)/def.factor,dt:.001,perturbation:.1};
  const sim=simulate(params);
  if(sim.status!=='complete')throw Error(`${def.id}: ${sim.diagnostics.errors.join('; ')}`);
  const comparison=makePathComparison(measured,sim.samples,{...projection,s1,s2,timeFactor:def.factor,offsetVideo:start,maxTime:params.duration,overlay:true});
  const rows=measured.filter(r=>r.t>=start-1e-8&&r.t<=end+1e-8).map(r=>{
    const tModel=(r.t-start)/def.factor, state=interpolate(sim.samples,tModel),model=projected(state.theta1,state.theta2);
    const a=r.valid?rawAngles(r):[null,null];
    const e1=r.valid?Math.hypot(model.x1-r.x1,model.y1-r.y1):null;
    const e2=r.valid?Math.hypot(model.x2-r.x2,model.y2-r.y2):null;
    const row={frame:r.frame,tVideo:r.t,tModel,valid:r.valid,usedForScore:r.valid&&r.t>=scoreStart-1e-8,
      measured:{x1:r.x1,y1:r.y1,x2:r.x2,y2:r.y2},model,
      measuredAnglesDeg:a.map(v=>v===null?null:v*DEG),modelAnglesDeg:[state.theta1*DEG,state.theta2*DEG],
      errorPx:[e1,e2],errorDeg:r.valid?[wrap(state.theta1-a[0])*DEG,wrap(state.theta2-a[1])*DEG]:[null,null]};
    predictionRows.push({scenario:def.id,...row});return row;
  });
  // Prove that the image projection is the inverse of the application's path mapping.
  let appParityMaxPx=0;
  const appPoints=new Map(comparison.measuredPath.filter(r=>r.valid).map(r=>[r.frame,r]));
  for(const r of rows.filter(r=>r.valid)){
    const p=appPoints.get(r.frame);if(!p)throw Error('Application comparison excluded an expected valid frame.');
    appParityMaxPx=Math.max(appParityMaxPx,Math.abs(p.x1*pixelsPerMeter-r.measured.x1),Math.abs(-p.y1*pixelsPerMeter-r.measured.y1),Math.abs(p.x2*pixelsPerMeter-r.measured.x2),Math.abs(-p.y2*pixelsPerMeter-r.measured.y2));
  }
  const scores=windows.map(w=>{
    const candidates=rows.filter(r=>r.tVideo>=w.start-1e-8&&r.tVideo<=w.end+1e-8);
    const valid=candidates.filter(r=>r.valid);
    return {...w,expectedCount:candidates.length,count:valid.length,rejectedCount:candidates.length-valid.length,
      actualVideoRange:[valid[0].tVideo,valid.at(-1).tVideo],
      positionPx:[0,1].map(i=>stats(valid.map(r=>r.errorPx[i]))),
      angleDeg:[0,1].map(i=>stats(valid.map(r=>r.errorDeg[i])))};
  });
  const profile={schema:'dubbele-slinger/v2',params,physicalValidation:'Voorwaardelijke videovoorspelling. Staafmassa’s bevestigd; tijdsfactor, markergeometrie, uniforme massaverdeling en demping niet gekalibreerd.',
    pathComparison:{timeFactor:def.factor,offsetVideo:start,maxTime:(21.5-start)/def.factor,marker1Fraction:1,marker2Fraction,pixelsPerMeter,cameraRollDeg:0,overlay:true,filename:'bewegingspaden.csv'},
    initialState:def.initial,scoreStartsVideo:scoreStart,scenario:def.id};
  const profileName=`instellingen-${def.id}.json`;
  await writeFile(path.join(output,profileName),JSON.stringify(profile,null,2)+'\n');
  scenarios.push({id:def.id,label:def.label,factor:def.factor,params,initial:def.initial,profileFile:profileName,
    diagnostics:sim.diagnostics,applicationParityMaxPx:appParityMaxPx,scores,rows,
    modelPath:sim.samples.map(s=>({tVideo:start+s.t*def.factor,...projected(s.theta1,s.theta2)}))});
}
const convergence=compareConvergence(scenarios[0].params);
if(!convergence.valid)throw Error('Primary scenario convergence check failed.');
const geometryWindows=[[10.5,11.8],[13.5,21.5],[21.5,53.5]].map(([lo,hi])=>{
  const rows=measured.filter(r=>r.valid&&r.t>=lo&&r.t<=hi);
  return {videoRange:[lo,hi],count:rows.length,upperRadiusPx:stats(rows.map(r=>Math.hypot(r.x1,r.y1))),lowerRadiusPx:stats(rows.map(r=>Math.hypot(r.x2-r.x1,r.y2-r.y1)))};
});
const result={schema:'dubbele-slinger/conditional-path-comparison/v1',createdAt:new Date().toISOString(),
  status:'CONDITIONAL COMPARISON; not independently calibrated physical validation',
  sources:{pathCSV:{sha256:hash(source),filename:'bewegingspaden.csv'},massRecord:{sha256:hash(massBytes),filename:'practicum-gegevens.json'},
    physicsSha256:hash(await readFile(path.join(root,'physics.js'))),driverSha256:hash(await readFile(fileURLToPath(import.meta.url)))},
  confirmed:{s1,s2,rodMass1,rodMass2,m1:0,m2:0},videoStart:start,videoEnd:end,scoreStart,primaryScenario:'f8-free',
  timeScaleConfirmed:false,projection,initial7,initial11,geometryWindows,scenarios,
  numericalCheck:{maxPositionDifferenceM:convergence.maxPositionDifference,maxPositionDifferenceProjectedPx:convergence.maxPositionDifference*pixelsPerMeter,
    coarseMaxStep:convergence.coarseMaxStep,fineMaxStep:convergence.fineMaxStep,comparedSamples:convergence.comparedSamples,
    outputIntervalModelSeconds:.01,interpolation:'Linear interpolation of unwrapped simulation angles, as in the HTML path panel.'},
  limitations:['No fit of masses, damping, time factor, initial state or geometry against future scored frames.',
    'A better matching time scenario does not confirm capture speed or slowdown.',
    'Initial state comes from measured projected marker angles, not calibrated hinge angles; initial frames are excluded from scores.',
    'Image projection assumes orange at hinge, a fixed green position, vertical camera and isotropic scale. Lower marker radius changes substantially during motion.',
    'Rigid rods assumed uniform/slender with inertia mL²/12 around COM; actual mass distribution and overhang unmeasured.',
    'Missing/rejected marker pairs remain gaps, never replaced with simulated or interpolated measurements.',
    'RMS pixel/angle mismatch describes this scenario only; no calibrated millimetre error, percentage agreement or chaos claim.']};
if(hash(await readFile(path.join(input,'bewegingspaden.csv')))!==result.sources.pathCSV.sha256)throw Error('Input changed.');
await writeFile(path.join(output,'vergelijking.json'),JSON.stringify(result,null,2)+'\n');
const header=['scenario','frame','t_video_s','t_model_s','valid','used_for_score','measured_x1_px','measured_y1_px','measured_x2_px','measured_y2_px','model_x1_px','model_y1_px','model_x2_px','model_y2_px','error1_px','error2_px','angle_error1_deg','angle_error2_deg'];
const csv=[header.join(','),...predictionRows.map(r=>[r.scenario,r.frame,r.tVideo,r.tModel,Number(r.valid),Number(r.usedForScore),r.measured.x1,r.measured.y1,r.measured.x2,r.measured.y2,r.model.x1,r.model.y1,r.model.x2,r.model.y2,...r.errorPx,...r.errorDeg].map(v=>v??'').join(','))].join('\n')+'\n';
await writeFile(path.join(output,'afwijkingen.csv'),csv);
console.log(JSON.stringify({output,projection,initial7,numericalCheck:result.numericalCheck,scenarios:scenarios.map(s=>({id:s.id,scores:s.scores}))},null,2));
