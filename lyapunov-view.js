import { preparePhaseSeries, pairDivergence, singleSeriesDivergence, fitDivergence } from './lyapunov.js';
import { parseMeasurementCSV } from './measurements.js';

const $ = id => document.getElementById(id);
const fields = { mode:'lyap-mode', clock:'lyap-clock', factor:'lyap-factor', offset:'lyap-offset', end:'lyap-end', tau:'lyap-tau', smoothing:'lyap-smoothing', gap:'lyap-gap', theiler:'lyap-theiler', horizon:'lyap-horizon', floor:'lyap-floor', radius:'lyap-radius', fitStart:'lyap-fit-start', fitEnd:'lyap-fit-end' };
const modes = ['single','twins','residual'];
const clocks = ['video','physical','scenario'];
const fmt = (n,d=4) => Number.isFinite(n) ? n.toLocaleString('nl-NL',{maximumFractionDigits:d}) : '—';
let primary=null, twin=null, loaded=null, filename='', version=0, current=null, initialized=false;
let dirtySimulation=false;

function settings() {
  const result={};
  for (const [key,id] of Object.entries(fields)) {
    const value=$(id).value;
    if (key==='mode'||key==='clock') result[key]=value;
    else { if(!value.trim()||!Number.isFinite(Number(value))) throw new Error('Vul alle analyse-instellingen met eindige getallen in.'); result[key]=Number(value); }
  }
  if(!modes.includes(result.mode)||!clocks.includes(result.clock)) throw new Error('Onbekende analysemethode of tijdas.');
  if(result.factor<=0||result.tau<=0||result.gap<=0||result.horizon<=0||result.radius<=0||result.theiler<=0) throw new Error('Tijdfactor, τ, maximale onderbreking, Theiler-venster, horizon en buurafstand moeten positief zijn.');
  if(result.floor<0||result.floor>=result.radius)throw new Error('De minimale beginafstand moet niet-negatief en kleiner dan de maximale beginafstand zijn.');
  if(result.offset<0||result.end<=result.offset) throw new Error('Het einde van het CSV-venster moet na het begin liggen.');
  if(!Number.isInteger(result.smoothing)||result.smoothing<3||result.smoothing>101||result.smoothing%2!==1) throw new Error('Gebruik een oneven snelheidsvenster van 3 tot 101 meetpunten.');
  if(result.fitStart<0||result.fitEnd<=result.fitStart) throw new Error('Het fitinterval moet een niet-negatief begin en een later einde hebben.');
  if(result.clock==='video'&&result.factor!==1&&result.mode!=='twins') throw new Error('Bij onbekende tijdschaal blijft de factor 1. Kies “Scenario” om een onbevestigde vertraging te onderzoeken.');
  if(result.mode==='residual'&&result.clock==='video') throw new Error('Meting versus simulatie vereist fysieke seconden of een expliciet tijdscenario.');
  return result;
}

function unit(c) { return c.mode==='twins'||c.clock==='physical' ? 's' : c.clock==='scenario' ? 'scenario-s' : 'video-s'; }
function xml(text) { return String(text).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch])); }
function svgChart(rows,fit,c) {
  const width=1120,height=430,left=88,right=28,top=66,bottom=65;
  const valid=rows.filter(r=>Number.isFinite(r.value));
  let xmin=Math.min(...rows.map(r=>r.t)),xmax=Math.max(...rows.map(r=>r.t));
  if(xmax<=xmin)xmax=xmin+1;
  const values=valid.map(r=>r.value);
  if(fit)values.push(fit.intercept+fit.slope*fit.start,fit.intercept+fit.slope*fit.end);
  let ymin=Math.min(0,...values),ymax=Math.max(0,...values),pad=Math.max(.1,(ymax-ymin)*.12);
  ymin-=pad;ymax+=pad;
  const x=t=>left+(t-xmin)/(xmax-xmin)*(width-left-right),y=v=>top+(ymax-v)/(ymax-ymin)*(height-top-bottom);
  let grid='',labels='';
  for(let i=0;i<=5;i++) {
    const t=xmin+(xmax-xmin)*i/5,v=ymin+(ymax-ymin)*i/5;
    grid+=`<path d="M${x(t)},${top}V${height-bottom} M${left},${y(v)}H${width-right}"/>`;
    labels+=`<text x="${x(t)}" y="${height-bottom+24}" text-anchor="middle">${xml(fmt(t,2))}</text><text x="${left-12}" y="${y(v)+5}" text-anchor="end">${xml(fmt(v,2))}</text>`;
  }
  let d='',previous=null;
  for(const r of rows) {
    if(!Number.isFinite(r.value)||r.valid===false){previous=null;continue;}
    d+=(previous&&previous.segment===r.segment?'L':'M')+x(r.t).toFixed(2)+','+y(r.value).toFixed(2)+' '; previous=r;
  }
  const fitPath=fit?`<path d="M${x(fit.start)},${y(fit.intercept+fit.slope*fit.start)}L${x(fit.end)},${y(fit.intercept+fit.slope*fit.end)}" fill="none" stroke="#d32f2f" stroke-width="3" stroke-dasharray="10 6"/>`:'';
  const title=c.mode==='residual'?'Faseruimte-afwijking en groeifit':'Faseruimte-divergentie en Lyapunov-fit';
  const curve=c.mode==='single'?'Gemiddelde ln(δⱼ(t)/δⱼ(0))':'ln(δ(t)/δ(0))';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height+34}" role="img" aria-label="${xml(title)}"><rect width="100%" height="100%" fill="white"/><g font-family="Segoe UI,Arial,sans-serif" fill="#26353b"><text x="${width/2}" y="26" text-anchor="middle" font-size="20">${title}</text><text x="${left}" y="49" fill="#1646e5" font-size="13">${curve}</text><text x="${width-right}" y="49" text-anchor="end" fill="#c42e2e" font-size="13">${fit?`Fit: λ = ${xml(fmt(fit.slope))} ${unit(c)}⁻¹ · R² = ${xml(fmt(fit.r2,3))}`:'Geen geldige fit'}</text><g stroke="#dce0e3" stroke-width="1" fill="none">${grid}</g><g font-size="13">${labels}<text x="${width/2}" y="${height-12}" text-anchor="middle">${c.mode==='single'?'Volgtijd vanaf buurpaar':'Analyse-/modeltijd'} (${unit(c)})</text><text transform="translate(23 ${height/2}) rotate(-90)" text-anchor="middle">${c.mode==='single'?'Gemiddelde ln(δⱼ / δⱼ₀)':'ln(δ / δ₀)'}</text></g><path d="${d}" fill="none" stroke="#1646e5" stroke-width="1.8"/>${fitPath}<text x="${width/2}" y="${height+20}" text-anchor="middle" font-size="11">${xml(`Methode: ${{single:'één opname',twins:'twee simulaties',residual:'modelafwijking'}[c.mode]} · τ = ${fmt(c.tau)} ${unit(c)} · eindige-vensterhelling; geen bevestigde maximale Lyapunov-exponent`)}</text></g></svg>`;
}

function setStatus(message) { $('lyap-status').textContent=message; }
function clear(message) {
  current=null;$('lyap-chart').replaceChildren();$('lyap-metrics').replaceChildren();
  for(const id of ['lyap-export-csv','lyap-export-svg','lyap-export-json'])$(id).disabled=true;
  setStatus(message);
}
function controls() {
  const mode=$('lyap-mode').value;
  $('lyap-measured-controls').hidden=mode==='twins';
  $('lyap-neighbor-controls').hidden=mode!=='single';
  $('lyap-mode-hint').textContent=mode==='single'
    ? 'Eén opname: zoek nabije toestanden op verschillende momenten. Volg dezelfde buurparen over de hele horizon en neem het gemiddelde van hun logaritmische afstandsgroei.'
    : mode==='twins' ? 'Twee simulaties met een kleine wijziging in de beginhoek. Een fit over een eindig interval is nog geen maximale Lyapunov-exponent.'
    : 'Meting tegenover model: de helling beschrijft groei van het modelverschil. Dit is geen experimentele Lyapunov-exponent.';
}
function measuredSeries(c) {
  if(!loaded)throw new Error('Laad eerst een lokaal hoekbestand, bijvoorbeeld hoeken-videotijd.csv. De opname zelf wordt niet geüpload.');
  const rows=loaded.filter(r=>r.t>=c.offset&&r.t<=c.end);
  if(rows.length<2)throw new Error('Te weinig meetpunten in dit CSV-venster.');
  if(rows.length>10000)throw new Error('Kies een korter analysevenster met maximaal 10.000 meetpunten.');
  return preparePhaseSeries(rows,{timeFactor:c.factor,timeOffset:c.offset,smoothingWindow:c.smoothing,maxGap:c.gap/c.factor});
}
function render() {
  controls();
  try {
    const c=settings();
    if(c.mode!=='single'&&(!primary||!twin))throw new Error('Bereken eerst een simulatie.');
    if(c.mode!=='single'&&dirtySimulation)throw new Error('Simulatie-instellingen gewijzigd. Bereken de proef opnieuw vóór deze vergelijking.');
    let result,prepared=null;
    if(c.mode==='single') {
      prepared=measuredSeries(c);
      result=singleSeriesDivergence(prepared,{tau:c.tau,theiler:c.theiler,horizon:c.horizon,minInitialDistance:c.floor,maxInitialDistance:c.radius,maxGap:c.gap/c.factor,maxPairs:250,minPairs:10});
    } else if(c.mode==='twins') result=pairDivergence(primary.samples,twin.samples,{tau:c.tau,maxGap:.1});
    else {
      prepared=measuredSeries(c);
      result=pairDivergence(prepared,primary.samples,{tau:c.tau,maxGap:c.gap/c.factor});
    }
    if(!result.rows.some(r=>Number.isFinite(r.value)))throw new Error('Geen geldige positieve beginafstand; er kan geen logaritmische divergentie worden berekend.');
    let fit=null,fitError='';
    try { fit=fitDivergence(result.rows,{start:c.fitStart,end:c.fitEnd}); } catch(error) { fitError=error.message; }
    const svg=svgChart(result.rows,fit,c);
    $('lyap-chart').innerHTML=svg;
    $('lyap-metrics').replaceChildren();
    for(const [label,value] of [['Helling λ',fit?`${fmt(fit.slope)} ${unit(c)}⁻¹`:'Geen fit'],['R²',fmt(fit?.r2,3)],['Fitpunten',fit?.count??0],[c.mode==='single'?'Vaste buurparen':'Beginafstand δ₀',c.mode==='single'?result.pairCount:fmt(result.delta0,6)]]) {
      const cell=document.createElement('div'),small=document.createElement('span'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;cell.append(small,strong);$('lyap-metrics').append(cell);
    }
    const temporal=c.mode==='twins'?'Simulatietijd.':c.clock==='video'?'Fysieke tijdschaal onbekend: λ is per videoseconde.':c.clock==='scenario'?`Onbevestigd tijdscenario: t = (CSV-t − ${fmt(c.offset)}) / ${fmt(c.factor)}. Geen gekalibreerde fysieke exponent.`:`Tijdconversie door gebruiker bevestigd: t = (CSV-t − ${fmt(c.offset)}) / ${fmt(c.factor)}.`;
    const warnings=[...(result.warnings??[]),...(fit?.warnings??[])];
    if(fit&&Number.isFinite(fit.r2)&&fit.r2<.8)warnings.push('Het gekozen interval is weinig lineair (R² < 0,8); gebruik deze helling niet als betrouwbare exponent.');
    if(c.mode==='residual')warnings.push('Modelafwijking, geen Lyapunov-exponent.');
    if(c.mode!=='twins'&&c.factor!==1)warnings.push('Let op: de tijdfactor herschaalt ook hoeksnelheid. Voor dezelfde norm en hetzelfde analysevenster moeten τ, Theiler-venster, horizon en fitgrenzen eveneens door die factor worden gedeeld. CSV-begin, CSV-einde en maximale CSV-tijdstap blijven gelijk.');
    if(c.mode!=='single'&&(primary.diagnostics.relativeEnergyError>1e-5))warnings.push('Controleer de numerieke nauwkeurigheid van de simulatie.');
    const fitSummary=fit?`Fit over ${fmt(fit.start,4)}–${fmt(fit.end,4)} ${unit(c)} (${fit.count} punten).`:`Geen fit: ${fitError}`;
    const quality=fit&&Number.isFinite(fit.r2)&&fit.r2<.8?'Het gekozen interval is weinig lineair (R² < 0,8); dit is geen betrouwbare exponent.':'';
    const scaleNote=c.mode!=='twins'&&c.factor!==1?'Bij verandering van de tijdfactor moeten τ, Theiler-venster, horizon en fitgrenzen meegeschaald worden om dezelfde analyse te behouden.':'';
    setStatus(`${temporal} ${fitSummary} ${quality} ${c.mode==='residual'?'Dit meet modelafwijking, geen Lyapunov-exponent.':'Een positieve helling alleen bewijst geen chaos. Controleer meerdere fitintervallen, snelheidsvensters en buurafstanden.'} ${scaleNote}`);
    current={settings:c,result,prepared:prepared?.diagnostics,fit,svg,filename:c.mode==='twins'?null:filename,timeUnit:unit(c),warnings};
    for(const id of ['lyap-export-csv','lyap-export-svg','lyap-export-json'])$(id).disabled=false;
  } catch(error) { clear(error.message); }
}
function download(name,text,type) {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function getDivergenceSettings() {
  try{return {...settings(),filename:filename||null};}catch(error){return{valid:false,error:error.message};}
}
export function restoreDivergenceSettings(c) {
  if(!c||typeof c!=='object')return;
  for(const [key,id] of Object.entries(fields)) {
    if((key==='mode'&&modes.includes(c[key]))||(key==='clock'&&clocks.includes(c[key]))||(typeof c[key]==='number'&&Number.isFinite(c[key])))$(id).value=String(c[key]);
  }
  version++;loaded=null;filename='';$('lyap-file').value='';$('lyap-file-label').textContent=c.filename?`${c.filename} · opnieuw lokaal laden`:'Selecteer een lokaal hoekbestand';render();
}
export function updateDivergenceView(p,q) { primary=p;twin=q;dirtySimulation=false;render(); }
export function markDivergenceStale() { dirtySimulation=true;if($('lyap-mode').value!=='single')clear('Simulatie-instellingen gewijzigd. Bereken de proef opnieuw.'); }
export function initDivergenceView() {
  if(initialized)return;initialized=true;
  $('lyap-calculate').addEventListener('click',render);
  for(const id of Object.values(fields))$(id).addEventListener('input',()=>{controls();clear('Analyse-instellingen gewijzigd. Klik op Analyseer divergentie.');});
  $('lyap-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;const task=++version;loaded=null;filename='';clear('Hoekbestand lokaal inlezen…');
    try {if(file.size>5e6)throw new Error('Maximaal 5 MB per hoekbestand.');const text=await file.text();if(task!==version)return;loaded=parseMeasurementCSV(text);filename=file.name;$('lyap-file-label').textContent=filename;render();}
    catch(error){if(task===version){loaded=null;$('lyap-file-label').textContent='Bestand niet ingelezen';clear(error.message);}}
    finally {if(task===version)event.target.value='';}
  });
  $('lyap-clear').addEventListener('click',()=>{version++;loaded=null;filename='';$('lyap-file').value='';$('lyap-file-label').textContent='Selecteer een lokaal hoekbestand';render();});
  $('lyap-export-svg').addEventListener('click',()=>{if(current)download('faseruimte-divergentie.svg',current.svg,'image/svg+xml');});
  $('lyap-export-csv').addEventListener('click',()=>{if(!current)return;const {result,fit}=current;const header=`# Tijd: ${current.timeUnit}; methode: ${current.settings.mode}; geen automatische chaosconclusie\nt,delta,ln_delta_ratio,fit,fit_used\n`;download('faseruimte-divergentie.csv',header+result.rows.map(r=>{const used=fit&&r.t>=fit.start&&r.t<=fit.end&&Number.isFinite(r.value);return[r.t,Number.isFinite(r.delta)?r.delta:'',Number.isFinite(r.value)?r.value:'',used?fit.intercept+fit.slope*r.t:'',used?1:0].join(',');}).join('\n'),'text/csv;charset=utf-8');});
  $('lyap-export-json').addEventListener('click',()=>{if(current){const {result,svg,...report}=current;download('divergentie-analyse.json',JSON.stringify({schema:'dubbele-slinger/divergence-v1',...report,pairCount:result.pairCount,diagnostics:result.diagnostics,normalization:{t0:result.t0,delta0:result.delta0},note:'Geen ruwe meetreeks opgenomen; laad het oorspronkelijke lokale CSV opnieuw.'},null,2),'application/json');}});
  $('lyap-import-json').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    try {if(file.size>1e6)throw new Error('Maximaal 1 MB per analyserapport.');const report=JSON.parse(await file.text());if(report.schema!=='dubbele-slinger/divergence-v1'||!report.settings)throw new Error('Geen ondersteund divergentierapport.');restoreDivergenceSettings({...report.settings,filename:report.filename});}
    catch(error){clear(error.message);}finally{event.target.value='';}
  });
  controls();clear('Laad een lokaal hoekbestand om één opname te analyseren, of kies de twee simulaties.');
}
