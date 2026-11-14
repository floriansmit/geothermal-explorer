import { simulateScreening } from "./doublet-screening.mjs";

self.onmessage = ({data: c}) => {
  try {
    const n = c.extent / c.resolution;
    if (Object.values(c).some(v => !Number.isFinite(v)) ||
        !Number.isInteger(n) || n < 10 || n > 120 || c.resolution < 25 || c.resolution > 200 ||
        c.extent < 1000 || c.extent > 10000 || !Number.isInteger(c.years) || c.years < 1 || c.years > 50 ||
        c.spacing < 2*c.resolution || c.spacing > c.extent-4*c.resolution ||
        c.permeability <= 0 || c.thickness <= 0 || c.porosity <= 0 || c.porosity >= 1 ||
        c.depth <= 0 || c.injection < 5 || c.temperature <= c.injection || c.temperature > 180 ||
        c.pressure_window <= 0 || Math.min(c.winter,c.summer)<=0 || Math.max(c.winter,c.summer)>600) {
      throw new Error("Check the reservoir and pumping inputs. Use 10–120 whole cells per side, at least two cells between wells, and 1–50 years.");
    }
    const {frames,history,wells} = simulateScreening(c);
    const encoded = frames.map(frame=>{
      const bytes = new Uint8Array(2*frame.length);
      const values = new DataView(bytes.buffer);
      frame.forEach((v,i)=>{
        if (!Number.isFinite(v)) throw new Error("Temperature solution did not converge.");
        values.setInt16(2*i,Math.round(v*10),true);
      });
      return btoa(String.fromCharCode(...bytes));
    });
    self.postMessage({result:{case:c,n,wells,frames:encoded,history:history.map(p=>[
      p.day,p.temperature+273.15,-24*p.rate,p.injectionPressure,p.productionPressure
    ])}});
  } catch(error) { self.postMessage({error:String(error.message || error)}); }
};
