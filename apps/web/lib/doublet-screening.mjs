// Uniform confined aquifer. Coordinates are local cell centres, time is in hours.
// Independently predicts flow and cooling from the case inputs alone.
export function simulateScreening(c) {
  const n = c.extent / c.resolution, count = n * n;
  const angle = c.azimuth * Math.PI / 180;
  const wells = [-1, 1].map(sign => [Math.sin(angle), Math.cos(angle)].map(v =>
    Math.floor(n / 2 + sign * c.spacing * v / (2 * c.resolution) + 1e-9)));
  const [injector, producer] = wells;
  const wellIndex = ([x, y]) => x + n * y;
  const inj = wellIndex(injector), prod = wellIndex(producer);
  const east = new Float64Array(count), north = new Float64Array(count);
  // Integrated unit-source discharge through a unit face in an infinite plane.
  function face(normal, tangent) {
    return Math.atan2(normal, normal * normal + tangent * tangent - 0.25) / (2 * Math.PI);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    for (const [w, sign] of [[injector, 1], [producer, -1]]) {
      east[y*n+x] += sign * face(x + 0.5 - w[0], y - w[1]);
      north[y*n+x] += sign * face(y + 0.5 - w[1], x - w[0]);
    }
  }
  const viscosity = t => 2.414e-5 * 10 ** (247.8 / (t + 133.15));
  const distance = Math.hypot(producer[0]-injector[0], producer[1]-injector[1])*c.resolution;
  const resistance = Math.log(distance / 0.11) /
    (2*Math.PI*c.permeability*9.869233e-16*c.thickness*3600*1e5);
  const heatCapacity = c.porosity*4.18e6 + (1-c.porosity)*2.2e6;
  const volume = c.resolution**2 * c.thickness * heatCapacity / 4.18e6;
  const diffusion = ((1-c.porosity)*2.5 + c.porosity*2) * 3600 / (heatCapacity*c.resolution**2);
  let cooling = new Float64Array(count), next = cooling.slice();
  const frames = [], history = [];
  let hours = 0;
  for (let season = 0; season < c.years*2; season++) {
    const target = season%2 ? c.summer : c.winter;
    const initialPressure = 1.013 + .0981*(c.depth+c.thickness/2);
    const rI = resistance*viscosity(c.injection), rP = resistance*viscosity(c.temperature);
    const rate = Math.min(target, c.pressure_window/(2*rI), (initialPressure-Math.max(2,initialPressure-c.pressure_window/2))/rP);
    const steps = Math.ceil(4383*(rate/volume + 4*diffusion)/0.45);
    const dt = 4383/steps, adv = dt*rate/volume, diff = dt*diffusion;
    for (let step=0; step<steps; step++) {
      next.set(cooling);
      for (let y=1; y<n-1; y++) for (let x=1; x<n-1; x++) {
        const i=y*n+x, u=cooling[i];
        const flux = (v,a,b) => v*(v>=0?a:b);
        next[i] += adv*(flux(east[i-1],cooling[i-1],u)-flux(east[i],u,cooling[i+1])
          +flux(north[i-n],cooling[i-n],u)-flux(north[i],u,cooling[i+n]))
          +diff*(cooling[i-1]+cooling[i+1]+cooling[i-n]+cooling[i+n]-4*u);
      }
      next[inj] += adv*(c.temperature-c.injection);
      next[prod] -= adv*cooling[prod];
      [cooling,next]=[next,cooling];
    }
    hours+=4383;
    history.push({day:hours/24,rate,temperature:c.temperature-cooling[prod],deltaP:rate*(rI+rP)});
    if (season%2) frames.push(cooling.slice());
  }
  return {frames,history};
}
