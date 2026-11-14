// Run: node benchmarks/gassum-doublet.mjs
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {simulateScreening} from '../apps/web/lib/doublet-screening.mjs';

for (const name of ['steady','seasonal','higher']) {
  const path=new URL('../apps/web/public/data/doublet-'+name+'.json.gz',import.meta.url);
  const reference=JSON.parse(gunzipSync(readFileSync(path)));
  const model=simulateScreening(reference.case);
  let hours=0, volume=0, predictedVolume=0, tempErr=0, pressureErr=0;
  let maxCellError=0, fieldSum=0, intersection=0, union=0, areas;
  for (const [day,kelvin,q,pIn,pOut] of reference.history) {
    const h=day*24, dt=h-hours;
    if(dt<=0) continue;
    const season=Math.min(model.history.length-1,Math.ceil(day/(365.25/2)-1e-9)-1);
    const pred=model.history[Math.max(0,season)];
    volume+=(-q/24)*dt; predictedVolume+=pred.rate*dt;
    pressureErr+=(pred.deltaP-(pIn-pOut))**2*dt;
    hours=h;
  }
  // Same illustrative direct-heat economics as Explorer; t=0 CAPEX cancels in the difference.
  function npv(series) {
    let prior=0, discounted=-reference.capex;
    for(const [day,temp,flow,dp] of series){
      const dt=(day-prior)*24;
      const heat=Math.min(15,flow*4.18*Math.max(0,temp-reference.case.injection)/3600);
      const power=flow/3600*Math.max(0,dp)*0.1/.72;
      discounted+=dt*((60*heat-100*power)/1e6-.25/8766)/1.05**Math.ceil(day/365.25-1e-10);
      prior=day;
    }
    return discounted;
  }
  const referenceNpv=npv(reference.history.map(([day,k,q,pi,po])=>[day,k-273.15,-q/24,pi-po]));
  const candidateNpv=npv(model.history.map(p=>[p.day,p.temperature,p.rate,p.deltaP]));
  let referenceBreak=null, candidateBreak=null;
  for (const [year,frame] of model.frames.entries()) {
    const raw=Buffer.from(reference.frames[year],'base64');
    const sample=reference.history.find(r=>Math.abs(r[0]-(year+1)*365.25)<1e-6);
    const temp=sample[1]-273.15, predictedTemp=model.history[year*2+1].temperature;
    tempErr=Math.max(tempErr,Math.abs(temp-predictedTemp));
    if(referenceBreak===null && reference.case.temperature-temp>=1) referenceBreak=year+1;
    if(candidateBreak===null && reference.case.temperature-predictedTemp>=1) candidateBreak=year+1;
    let refArea=0, predArea=0;
    for(let i=0;i<frame.length;i++){
      const ref=raw.readInt16LE(i*2)/10, err=frame[i]-ref;
      fieldSum+=err*err; maxCellError=Math.max(maxCellError,Math.abs(err));
      if(year===model.frames.length-1){
        refArea+=Number(ref>=1); predArea+=Number(frame[i]>=1);
        intersection+=Number(ref>=1 && frame[i]>=1); union+=Number(ref>=1 || frame[i]>=1);
      }
    }
    areas=[refArea,predArea].map(v=>v*reference.case.resolution**2/1e6);
  }
  console.log(name,JSON.stringify({meanRates:[volume/hours,predictedVolume/hours],
    npvMillionEuro:[referenceNpv,candidateNpv],pressureRmse:Math.sqrt(pressureErr/hours),maxYearEndProducerError:tempErr,
    annualFieldRmse:Math.sqrt(fieldSum/(model.frames.length*reference.n**2)),maxCellError,
    finalColdAreaKm2:areas,finalPlumeIoU:intersection/union,breakthroughYears:[referenceBreak,candidateBreak]}));
}
