import { DEFAULTS, simulate, compareConvergence } from './physics.js';
import { parseMeasurementCSV, compareMeasurements, exportSimulationCSV } from './measurements.js';
import { initPathView, updatePathView, getPathComparisonSettings, restorePathComparisonSettings } from './path-view.js';

const $ = id => document.getElementById(id);
const DEG = 180 / Math.PI;
const fmt = (n,d=2) => Number.isFinite(n) ? n.toLocaleString('nl-NL',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const scientific = n => Number.isFinite(n) ? n.toExponential(1).replace('.',',') : '—';
const parameterNames = ['s1','s2','m1','m2','rodMass1','rodMass2','g','c1','c2','theta1','theta2','omega1','omega2','duration','dt','perturbation'];
const rodExample={model:'rigid',m1:0,m2:0,rodMass1:.2,rodMass2:.2,c1:.002,c2:.001};
// Only the two lengths are confirmed for this apparatus. The reported masses
// remain unassigned until their meaning (whole body or extra weight) is known.
const presets={rods:rodExample,practicum:{...rodExample,s1:.203,s2:.157},rotation:{model:'rigid',rodMass1:.05,rodMass2:.05,theta1:120,theta2:-10,duration:10},default:{theta1:25,theta2:-15},small:{theta1:5,theta2:0},large:{theta1:60,theta2:25},slack:{theta1:80,theta2:20}};
let primary=null,twin=null,convergence=null,measurements=[],comparison=null,currentTime=0,playing=false,lastFrame=0,worker=null,job=0,busy=false,dirty=false;
let separation=[], viewBounds=null;
const colors={one:'#008c94',two:'#d26948',ghost:'#889b7f',grid:'#e4e8df',ink:'#74847f'};

function getParams(){return {...Object.fromEntries(parameterNames.map(key=>[key,Number($(key).value)])),model:$('model').value};}
function updateModelFields(){const rigid=$('model').value==='rigid';$('rod-fields').hidden=!rigid;for(const key of ['rodMass1','rodMass2'])$(key).disabled=!rigid;for(const key of ['m1','m2'])$(key).min=rigid?'0':'0.01';$('model-hint').textContent=rigid?'Stangen kunnen trekken en duwen. Hun verdeelde massa telt mee.':'Touw kan alleen trekken. De berekening stopt bij verlies van spanning.';$('mass-hint').textContent=rigid?'Stangen: uniforme slanke staven. Geen extra gewichten? Zet m₁ en m₂ op 0.':'Touw/draad: massaloos en onrekbaar. Beide gewichten moeten een positieve massa hebben.';}
function setParams(p){for(const key of [...parameterNames,'model']) if(key in p) $(key).value=p[key];updateModelFields();}
function setPlay(value){playing=value;$('play').textContent=value?'Ⅱ':'▶';$('play').setAttribute('aria-label',value?'Pauzeren':'Afspelen');lastFrame=0;}
function sampleAt(samples,t){
  if(!samples?.length || t<samples[0].t-1e-8 || t>samples.at(-1).t+1e-8)return null;
  let low=0,high=samples.length-1;
  while(high-low>1){const mid=(low+high)>>1;if(samples[mid].t<=t)low=mid;else high=mid;}
  const a=samples[low],b=samples[high],f=b.t>a.t?(t-a.t)/(b.t-a.t):0;
  const result={};for(const key of Object.keys(a)) result[key]=a[key]+(b[key]-a[key])*f;
  // Interpolate angles, then reconstruct exact constraints for the animation.
  const p=primary?.params;
  if(p){result.x1=p.s1*Math.sin(result.theta1);result.y1=-p.s1*Math.cos(result.theta1);result.x2=result.x1+p.s2*Math.sin(result.theta2);result.y2=result.y1-p.s2*Math.cos(result.theta2);}
  return result;
}
function failure(message){busy=false;$('calculate').disabled=false;$('form-state').textContent=message;$('model-message').className='notice error';$('model-message').textContent=message;$('run-badge').textContent='BEREKENING MISLUKT';setPlay(false);}
function acceptResult(result){
  if(result.id!==job)return;
  if(result.error)return failure(result.error);
  if(result.primary.status==='error')return failure(result.primary.diagnostics.errors.join(' '));
  primary=result.primary;twin=result.twin;
  updatePathView(primary);
  const {coarse, fine, ...compactConvergence}=result.convergence;convergence=compactConvergence;
  busy=false;dirty=parameterNames.some(key=>Number($(key).value)!==primary.params[key])||$('model').value!==primary.params.model;currentTime=0;setPlay(false);
  $('calculate').disabled=false;$('form-state').textContent=dirty?'Instellingen gewijzigd tijdens berekenen. Klik opnieuw op Bereken proef.':'Proef berekend. Druk op ▶ om af te spelen.';
  $('timeline').max=primary.samples.at(-1).t;$('timeline').value=0;
  $('energy-metric').textContent=scientific(primary.diagnostics.relativeEnergyError*100)+' %';
  $('energy-metric').title='Maximale fout in E + dissipatie, gedeeld door max(beginenergie, zwaartekrachtschaal). Geen percentage meetfout.';
  $('step-metric').textContent=convergence.valid===false?'ongeldig':convergence.comparedSamples<2?'n.v.t.':scientific(convergence.maxPositionDifference)+' m';
  $('step-metric').title=`Vergelijking Δt en Δt/2 over ${fmt(convergence.commonDuration,3)} s. Dit is geen foutgrens ten opzichte van de werkelijkheid.`;
  $('twin-description').textContent=`Alleen θ₂ begint ${fmt(primary.params.perturbation,3)}° anders. Vergelijking tot ${fmt(Math.min(primary.samples.at(-1).t,twin.samples.at(-1)?.t??0),3)} s. Dit is op zichzelf geen bewijs van chaos.`;
  separation=primary.samples.flatMap(s=>{const q=sampleAt(twin.samples,s.t);return q?[{t:s.t,value:Math.hypot(s.x2-q.x2,s.y2-q.y2)}]:[];});
  const length=primary.params.s1+primary.params.s2;
  viewBounds={minX:-length*.55,maxX:length*.55,minY:-length*.15,maxY:0};
  for(const s of [...primary.samples,...twin.samples])for(const n of [1,2]){viewBounds.minX=Math.min(viewBounds.minX,s['x'+n]);viewBounds.maxX=Math.max(viewBounds.maxX,s['x'+n]);viewBounds.minY=Math.min(viewBounds.minY,s['y'+n]);viewBounds.maxY=Math.max(viewBounds.maxY,s['y'+n]);}
  const msg=$('model-message'),rigid=primary.params.model==='rigid';
  $('force-title').textContent=rigid?'Axiale scharnierkrachten':'Trekkracht in de touwen';$('force-unit').textContent=rigid?'F · N':'T · N';$('force-one').textContent=rigid?'— F₁':'— T₁';$('force-two').textContent=rigid?'— F₂':'— T₂';$('force-description').textContent=rigid?'· Projectie aan boveneinde van elke stang; negatief is toegestaan.':'· Bij 0 N bereikt het model zijn grens.';
  $('tension-chart').setAttribute('aria-label',rigid?'Axiale projecties van de ophang- en scharnierreactie in newton':'Touwspanningen in newton');
  if(primary.status==='slack'){
    msg.className='notice warning';
    msg.textContent=`Modelgrens: touw ${primary.event.string} ${primary.event.t<1e-8?'kan bij deze beginstand niet gespannen blijven':'verliest spanning bij t = '+fmt(primary.event.t,4)+' s'}. De voorspelling stopt hier; vrije val en opnieuw strak trekken zijn niet gemodelleerd.`;
    $('run-badge').textContent='TOUW WORDT SLAP';$('run-badge').className='badge slack';
  }else if(rigid){
    msg.className='notice';msg.textContent=`Stangenmodel: ${fmt(primary.params.duration,1)} s berekend, inclusief verdeelde stangmassa en rotatietraagheid. Negatieve axiale reacties en volledige omwentelingen zijn toegestaan. De instellingen zijn nog niet geijkt op de practicumopstelling.`;$('run-badge').textContent='STANGEN · GEREED';$('run-badge').className='badge';
  }else{
    msg.className='notice';msg.textContent=`Beide touwen blijven gespannen gedurende ${fmt(primary.params.duration,1)} s. Kleinste berekende spanning: T₁ = ${fmt(primary.diagnostics.minTension1,3)} N, T₂ = ${fmt(primary.diagnostics.minTension2,3)} N. Dit is een modelvoorspelling, nog geen meting.`;
    $('run-badge').textContent='PROEF GEREED';$('run-badge').className='badge';
  }
  if(twin.status==='slack')msg.textContent+=` De vergelijkingsproef stopt bij ${fmt(twin.event.t,4)} s.`;
  if(twin.status==='error')msg.textContent+=' De vergelijkingsproef kon niet worden berekend: '+twin.diagnostics.errors.join(' ');
  if(primary.diagnostics.relativeEnergyError>1e-5 || convergence.valid===false){msg.classList.add('warning');msg.textContent+=' Let op: controleer de numerieke nauwkeurigheid; gebruik een kleinere tijdstap.';}
  if(convergence.maxPositionDifference>length*.01){msg.classList.add('warning');msg.textContent+=' De twee tijdstappen geven meer dan 1% van de totale lengte verschil. De lange baan is daardoor numeriek onzeker; verkort de proef en/of verklein Δt. Een goede energiebalans garandeert geen nauwkeurige baan.';}
  if(primary.diagnostics.warnings?.length)msg.textContent+=' '+primary.diagnostics.warnings.join(' ');
  updateComparison();drawAll();
}
async function calculate(){
  if(!$('settings-form').reportValidity())return;
  const params=getParams();
  if(parameterNames.some(key=>!Number.isFinite(params[key])))return failure('Vul voor iedere instelling een eindig getal in.');
  busy=true;setPlay(false);$('calculate').disabled=true;$('form-state').textContent='Berekenen, inclusief controle met halve tijdstap…';$('run-badge').textContent='BEREKENEN…';
  const id=++job;
  if(worker){worker.terminate();worker=null;}
  const fallback=()=>setTimeout(()=>{try{acceptResult({id,primary:simulate(params),twin:simulate({...params,theta2:params.theta2+params.perturbation}),convergence:compareConvergence(params)});}catch(error){failure(error.message);}},30);
  if(window.STANDALONE || !window.Worker){fallback();return;}
  try{worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>acceptResult(data);worker.onerror=()=>{worker.terminate();worker=null;fallback();};worker.postMessage({id,params});}catch{fallback();}
}

function canvasContext(id){const canvas=$(id),rect=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==Math.round(rect.width*ratio)||canvas.height!==Math.round(rect.height*ratio)){canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);}const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,rect.width,rect.height);return{ctx,w:rect.width,h:rect.height};}
function drawScene(){
  const {ctx,w,h}=canvasContext('pendulum');
  const p=primary?.params??getParams(),length=p.s1+p.s2;
  const extent=Math.max(0.1,length),bounds=viewBounds??{minX:-extent,maxX:extent,minY:-extent,maxY:0};
  const scale=Math.min((w-110)/(bounds.maxX-bounds.minX),(h-105)/Math.max(extent*.25,bounds.maxY-bounds.minY));
  const ox=w/2-(bounds.minX+bounds.maxX)*scale/2,oy=40+bounds.maxY*scale;
  const point=(x,y)=>[ox+x*scale,oy-y*scale];
  ctx.strokeStyle='#244650';ctx.lineWidth=1;
  const grid=extent/4;
  for(let i=-5;i<=5;i++){ctx.beginPath();ctx.moveTo(ox+i*grid*scale,30);ctx.lineTo(ox+i*grid*scale,h-36);ctx.stroke();ctx.beginPath();ctx.moveTo(30,oy+i*grid*scale);ctx.lineTo(w-30,oy+i*grid*scale);ctx.stroke();}
  ctx.strokeStyle='#4a666d';ctx.setLineDash([3,6]);ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox,oy+extent*scale);ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle='#6b868a';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ox-25,oy-10);ctx.lineTo(ox+25,oy-10);ctx.stroke();ctx.lineWidth=1;for(let i=-25;i<25;i+=9){ctx.beginPath();ctx.moveTo(ox+i,oy-10);ctx.lineTo(ox+i+7,oy-16);ctx.stroke();}
  if(!primary)return;
  const a=sampleAt(primary.samples,currentTime)??primary.samples[0];
  const trajectory=primary.samples.filter(s=>s.t<=currentTime&&s.t>=currentTime-6);
  ctx.lineWidth=1.3;ctx.strokeStyle='#b57c5670';ctx.beginPath();trajectory.forEach((s,i)=>{const v=point(s.x2,s.y2);i?ctx.lineTo(...v):ctx.moveTo(...v);});ctx.stroke();
  const drawPendulum=(s,ghost=false)=>{
    const p1=point(s.x1,s.y1),p2=point(s.x2,s.y2);
    ctx.lineWidth=ghost?1.5:p.model==='rigid'?9:2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=ghost?'#a4b9a080':'#b9d5cf';ctx.setLineDash(ghost?[5,5]:[]);ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(...p1);ctx.lineTo(...p2);ctx.stroke();ctx.setLineDash([]);ctx.lineCap='butt';ctx.lineJoin='miter';
    [[p1,'#59d3d0','m₁',p.m1],[p2,'#f2a078','m₂',p.m2]].forEach(([pos,color,label,mass])=>{const radius=ghost?7:Math.max(7,Math.min(17,8+Math.log10(mass*5+1)*7));ctx.beginPath();ctx.arc(...pos,radius,0,Math.PI*2);ctx.fillStyle=ghost?'#a4b9a050':color;ctx.fill();if(!ghost){ctx.strokeStyle='#0d2630';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#d2e3de';ctx.font='11px Segoe UI';ctx.fillText(label,pos[0]+radius+8,pos[1]+3);}});
    if(!ghost){ctx.fillStyle='#9fc3c5';ctx.font='11px Segoe UI';ctx.fillText(p.model==='rigid'?'s₁ · '+fmt(p.rodMass1,3)+' kg':'s₁',(ox+p1[0])/2+12,(oy+p1[1])/2);ctx.fillText(p.model==='rigid'?'s₂ · '+fmt(p.rodMass2,3)+' kg':'s₂',(p1[0]+p2[0])/2+12,(p1[1]+p2[1])/2);}
  };
  const b=twin?sampleAt(twin.samples,currentTime):null;if(b&&$('show-twin').checked)drawPendulum(b,true);drawPendulum(a);
  ctx.fillStyle='#d5e2d8';ctx.beginPath();ctx.arc(ox,oy,4,0,2*Math.PI);ctx.fill();
  $('scale-label').textContent=`raster ${fmt(grid,3)} m · ${p.model==='rigid'?'stangdikte en eindpunten schematisch':'gewichten schematisch'}`;
  $('twin-metric').textContent=b?fmt(Math.hypot(a.x2-b.x2,a.y2-b.y2),4)+' m':'buiten model';
  $('time-readout').innerHTML=fmt(currentTime,2)+' <small>s</small>';
}

function drawChart(id,series,{zero=false}={}){
  const {ctx,w,h}=canvasContext(id),left=48,right=12,top=15,bottom=26;
  const plotW=w-left-right,plotH=h-top-bottom,maxT=Math.max(primary?.samples.at(-1)?.t??1,0.1);
  let min=zero?0:Infinity,max=zero?0:-Infinity;
  for(const s of series)for(const row of s.rows){if(Number.isFinite(row.v)){min=Math.min(min,row.v);max=Math.max(max,row.v);}}
  if(!Number.isFinite(min)){min=0;max=1;}if(max-min<1e-10){const padding=Math.max(.1,Math.abs(max)*.08);min-=padding;max+=padding;}else{const pad=(max-min)*.1;min-=pad;max+=pad;}
  const x=t=>left+t/maxT*plotW,y=v=>top+(max-v)/(max-min)*plotH;
  ctx.font='10px Segoe UI';ctx.fillStyle=colors.ink;ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,yy=y(v);ctx.strokeStyle=colors.grid;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.textAlign='right';const av=Math.abs(v);ctx.fillText(av!==0&&(av<.01||av>=1e4)?v.toExponential(1):fmt(v,Math.abs(max-min)<1?3:1),left-7,yy+3);}
  for(let i=0;i<=4;i++){const t=maxT*i/4;ctx.textAlign='center';ctx.fillText(fmt(t,maxT<2?2:0),x(t),h-7);}ctx.textAlign='right';ctx.fillText('s',w-1,h-7);
  ctx.save();ctx.beginPath();ctx.rect(left,top,plotW,plotH);ctx.clip();
  if(min<0&&max>0){ctx.strokeStyle='#b1bfb4';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(left,y(0));ctx.lineTo(w-right,y(0));ctx.stroke();ctx.setLineDash([]);}
  for(const s of series){ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=s.dashed?1.3:1.7;ctx.setLineDash(s.dashed?[4,4]:[]);ctx.beginPath();let started=false;const skip=Math.max(1,Math.floor(s.rows.length/(plotW*2)));for(let i=0;i<s.rows.length;i+=skip){const row=s.rows[i];if(!Number.isFinite(row.v))continue;if(s.points){ctx.moveTo(x(row.t)+2,y(row.v));ctx.arc(x(row.t),y(row.v),2,0,Math.PI*2);}else if(started){ctx.lineTo(x(row.t),y(row.v));}else{ctx.moveTo(x(row.t),y(row.v));started=true;}}s.points?ctx.fill():ctx.stroke();}
  ctx.setLineDash([3,3]);ctx.strokeStyle='#73877680';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(currentTime),top);ctx.lineTo(x(currentTime),h-bottom);ctx.stroke();ctx.restore();ctx.setLineDash([]);
}
function drawCharts(){
  if(!primary)return;const samples=primary.samples;
  const series=(key,color,fn=v=>v)=>({color,rows:samples.map(s=>({t:s.t,v:fn(s[key],s)}))});
  const angles=[series('theta1',colors.one,v=>v*DEG),series('theta2',colors.two,v=>v*DEG)];
  if(comparison?.count){const offset=Number($('time-offset').value);angles.push({color:colors.one,points:true,rows:comparison.rows.map(r=>({t:r.t-offset,v:(r.modelTheta1+r.error1Deg/DEG)*DEG}))},{color:colors.two,points:true,rows:comparison.rows.map(r=>({t:r.t-offset,v:(r.modelTheta2+r.error2Deg/DEG)*DEG}))});}
  drawChart('angles-chart',angles);
  drawChart('tension-chart',[series('tension1',colors.one),series('tension2',colors.two)],{zero:true});
  drawChart('energy-chart',[series('energy',colors.ghost,(v,s)=>v+s.dissipated),series('energy',colors.one)]);
  drawChart('separation-chart',[{color:colors.two,rows:separation.map(r=>({t:r.t,v:r.value}))}],{zero:true});
}
function drawAll(){drawScene();drawCharts();}
function updateComparison(){
  comparison=null;$('measurement-result').replaceChildren();$('measurement-legend').textContent='· Absoluut vanaf verticaal omlaag';
  if(!measurements.length){$('measurement-status').textContent='Nog geen metingen geladen. Er is nog geen experimentele validatie.';drawCharts();return;}
  if(!primary)return;
  try{
    const timeOffset=Number($('time-offset').value),maxTime=Number($('compare-until').value);
    if(!$('time-offset').value.trim()||!Number.isFinite(timeOffset)||!Number.isFinite(maxTime)||maxTime<=0)throw new Error('Vul een geldige tijdverschuiving en een positief eindtijdstip in.');
    comparison=compareMeasurements(measurements,primary.samples,{timeOffset,maxTime});
    $('measurement-status').textContent=`${comparison.count} meetpunten vergeleken; ${comparison.excluded} buiten het gekozen venster of de modelgeldigheid. ${comparison.count?'RMSE is de hoekafwijking, geen automatisch goedkeuringscriterium.':'Geen overlap: controleer tijden en venster.'}`;
    if(comparison.count){for(const [label,value] of [['RMSE θ₁',comparison.rmse1Deg],['RMSE θ₂',comparison.rmse2Deg]]){const box=document.createElement('div'),caption=document.createElement('span'),number=document.createElement('strong');caption.textContent=label;number.textContent=fmt(value,3)+'°';box.append(caption,number);$('measurement-result').append(box);}$('measurement-legend').textContent='· Punten = ingelezen metingen (gekozen venster)';}
  }catch(error){$('measurement-status').textContent=error.message;}
  drawCharts();
}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function exportReady(){if(!primary||busy){$('export-status').textContent='Bereken eerst een proef.';return false;}if(dirty){$('export-status').textContent='Instellingen zijn gewijzigd. Bereken de proef opnieuw voordat je exporteert.';return false;}return true;}

$('settings-form').addEventListener('submit',e=>{e.preventDefault();calculate();});
$('settings-form').addEventListener('input',()=>{dirty=true;setPlay(false);$('form-state').textContent='Instellingen gewijzigd. De grafieken tonen nog de vorige proef; klik op Bereken proef.';});
$('model').addEventListener('change',()=>{updateModelFields();dirty=true;setPlay(false);$('form-state').textContent='Verbinding gewijzigd. Controleer de massa’s en klik op Bereken proef.';});
$('preset').addEventListener('change',()=>{setParams({...DEFAULTS,...presets[$('preset').value]});calculate();});
$('play').addEventListener('click',()=>{if(!primary||busy)return;if(currentTime>=primary.samples.at(-1).t)currentTime=0;if(primary.samples.at(-1).t===0)return;setPlay(!playing);drawAll();});
$('reset').addEventListener('click',()=>{setPlay(false);currentTime=0;$('timeline').value=0;drawAll();});
$('timeline').addEventListener('input',()=>{setPlay(false);currentTime=Number($('timeline').value);drawAll();});
$('show-twin').addEventListener('change',drawScene);
$('measurement-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5e6)throw new Error('Maximaal 5 MB per meetbestand.');const parsed=parseMeasurementCSV(await file.text());measurements=parsed;$('measurement-file-label').textContent=file.name;updateComparison();}catch(error){measurements=[];updateComparison();$('measurement-status').textContent=error.message;$('measurement-file-label').textContent='Bestand niet ingelezen';}e.target.value='';});
['time-offset','compare-until'].forEach(id=>$(id).addEventListener('input',updateComparison));
$('clear-measurements').addEventListener('click',()=>{measurements=[];$('measurement-file-label').textContent='Selecteer een lokaal bestand';updateComparison();});
$('csv-example').addEventListener('click',()=>download('voorbeeld-geen-echte-meting.csv','# Kunstmatige voorbeeldwaarden, GEEN echte metingen. Vervang met eigen videometingen.\nt,theta1_deg,theta2_deg\n0,25,-15\n0.1,22,-9\n0.2,16,3\n','text/csv;charset=utf-8'));
$('export-csv').addEventListener('click',()=>{if(exportReady()){download('dubbele-slinger-simulatie.csv',exportSimulationCSV(primary),'text/csv;charset=utf-8');$('export-status').textContent='Simulatie geëxporteerd; bewaar ook de JSON voor instellingen en modelgrens.';}});
$('export-json').addEventListener('click',()=>{if(exportReady()){download('dubbele-slinger-proef.json',JSON.stringify({schema:'dubbele-slinger/v2',physicalValidation:'Niet uitgevoerd; toewijzing van de aangeleverde practicum-massa’s nog onbekend.',createdAt:new Date().toISOString(),model:primary.params.model==='rigid'?'twee uniforme slanke stangen met eigen massa en optionele puntmassa’s':'twee massaloze onrekbare touwen, puntmassa’s, stopt bij slapte',angleConvention:'absolute hoeken vanaf omlaag; positief rechts',units:{parametersAngles:'deg',parametersOmega:'deg/s',length:'m',mass:'kg',time:'s',damping:'N m s/rad',x:'rechts',y:'omhoog'},params:primary.params,status:primary.status,event:primary.event,diagnostics:primary.diagnostics,convergence,twin:{params:twin.params,status:twin.status,event:twin.event},pathComparison:getPathComparisonSettings(),measurementComparison:comparison?{count:comparison.count,rmse1Deg:comparison.rmse1Deg,rmse2Deg:comparison.rmse2Deg,excluded:comparison.excluded,timeOffset:Number($('time-offset').value),maxTime:Number($('compare-until').value)}:null},null,2),'application/json');$('export-status').textContent='Instellingen, modelgrens en numerieke controles bewaard.';}});
$('import-json').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>2e6)throw new Error('Maximaal 2 MB per proefbestand.');
    const data=JSON.parse(await file.text());
    if(!['dubbele-slinger/v1','dubbele-slinger/v2'].includes(data.schema)||!data.params)throw new Error('Geen ondersteund dubbele-slinger-proefbestand.');
    const source=data.schema==='dubbele-slinger/v1'?{rodMass1:0,rodMass2:0,...data.params,model:'string'}:data.params;
    if(!['string','rigid'].includes(source.model))throw new Error('Onbekend verbindingsmodel.');
    const p={model:source.model};
    for(const key of parameterNames){
      if(typeof source[key]!=='number'||!Number.isFinite(source[key]))throw new Error('Ongeldige instelling: '+key);
      p[key]=source[key];const input=$(key),minimum=['m1','m2'].includes(key)?(p.model==='rigid'?0:.01):Number(input.min);
      if(input.tagName==='SELECT'&&![...input.options].some(o=>Number(o.value)===p[key]))throw new Error('Niet-ondersteunde tijdstap.');
      if((input.min!==''&&p[key]<minimum)||(input.max!==''&&p[key]>Number(input.max)))throw new Error('Instelling buiten bereik: '+key);
    }
    setParams(p);restorePathComparisonSettings(data.pathComparison);await calculate();$('export-status').textContent='Instellingen ingelezen; proef wordt opnieuw berekend.';
  }catch(error){$('export-status').textContent=error.message;}
  e.target.value='';
});

let resizePending=false;new ResizeObserver(()=>{if(!resizePending){resizePending=true;requestAnimationFrame(()=>{resizePending=false;drawAll();});}}).observe(document.querySelector('.simulation-column'));
document.addEventListener('visibilitychange',()=>{lastFrame=0;});
function frame(timestamp){
  if(playing&&primary&&!document.hidden){if(lastFrame){currentTime=Math.min(primary.samples.at(-1).t,currentTime+Math.min((timestamp-lastFrame)/1000,.1)*Number($('speed').value));$('timeline').value=currentTime;drawAll();if(currentTime>=primary.samples.at(-1).t)setPlay(false);}lastFrame=timestamp;}
  requestAnimationFrame(frame);
}
initPathView();
window.addEventListener('resize',()=>updatePathView(primary));
setParams({...DEFAULTS,...presets.rods});requestAnimationFrame(frame);calculate();
