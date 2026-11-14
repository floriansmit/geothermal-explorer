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
  const faces = wells.map(() => ({east:new Float64Array(count), north:new Float64Array(count)}));
  const east = new Float64Array(count), north = new Float64Array(count);
  // Integrated unit-source discharge through a unit face in an infinite plane.
  function face(normal, tangent) {
    return Math.atan2(normal, normal * normal + tangent * tangent - 0.25) / (2 * Math.PI);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    for (const [j,w] of wells.entries()) {
      faces[j].east[y*n+x] = face(x + 0.5 - w[0], y - w[1]);
      faces[j].north[y*n+x] = face(y + 0.5 - w[1], x - w[0]);
    }
  }
  const viscosity = t => 2.414e-5 * 10 ** (247.8 / (t + 133.15));
  const distance = Math.hypot(producer[0]-injector[0], producer[1]-injector[1])*c.resolution;
  // Fixed outer pressure: superpose the two well potentials. Each well has
  // its own rate target and BHP limit; lateral boundaries supply any imbalance.
  const radius = c.extent / 2;
  const geometry = 1 / (2*Math.PI*c.permeability*9.869233e-16*c.thickness*3600*1e5);
  const warmViscosity = viscosity(c.temperature);
  const wellRadius = 0.11;
  const crossResistance = geometry*warmViscosity*Math.log(radius/distance);
  const warmResistance = geometry*warmViscosity*Math.log(radius/wellRadius);
  const heatCapacity = c.porosity*4.18e6 + (1-c.porosity)*2.2e6;
  const volume = c.resolution**2 * c.thickness * heatCapacity / 4.18e6;
  const diffusion = ((1-c.porosity)*2.5 + c.porosity*2) * 3600 / (heatCapacity*c.resolution**2);
  let cooling = new Float64Array(count), next = cooling.slice();
  const frames = [], history = [];
  let hours = 0, injectedVolume = 0;
  for (let season = 0; season < c.years*2; season++) {
    const target = season%2 ? c.summer : c.winter;
    const initialPressure = 1.013 + .0981*(c.depth+c.thickness/2);
    // Approximate the log-weighted viscosity around each well using its cooled
    // near-well zone. The injected volume sets the equivalent swept radius.
    const cooledRadius = Math.min(radius, Math.sqrt(wellRadius**2 +
      injectedVolume * 4.18e6 / (Math.PI*c.thickness*heatCapacity)));
    const rI = warmResistance + geometry*(viscosity(c.injection)-warmViscosity)*Math.log(cooledRadius/wellRadius);
    const rP = warmResistance + geometry*(viscosity(c.temperature-cooling[prod])-warmViscosity)*Math.log(distance/wellRadius);
    const maxInjection = c.pressure_window/2;
    const maxDrawdown = initialPressure-Math.max(2,initialPressure-c.pressure_window/2);
    let injectionRate=target, rate=target;
    for (let k=0;k<20;k++) {
      injectionRate=Math.min(target,(maxInjection+crossResistance*rate)/rI);
      rate=Math.min(target,(maxDrawdown+crossResistance*injectionRate)/rP);
    }
    const drawdown = rP*rate-crossResistance*injectionRate;
    const deltaP = drawdown+rI*injectionRate-crossResistance*rate;
    for(let i=0;i<count;i++){
      east[i]=injectionRate*faces[0].east[i]-rate*faces[1].east[i];
      north[i]=injectionRate*faces[0].north[i]-rate*faces[1].north[i];
    }
    const steps = Math.ceil(4383*(Math.max(injectionRate,rate)/volume + 4*diffusion)/0.45);
    const dt = 4383/steps, adv = dt/volume, diff = dt*diffusion;
    for (let step=0; step<steps; step++) {
      next.set(cooling);
      for (let y=1; y<n-1; y++) for (let x=1; x<n-1; x++) {
        const i=y*n+x, u=cooling[i];
        const flux = (v,a,b) => v*(v>=0?a:b);
        next[i] += adv*(flux(east[i-1],cooling[i-1],u)-flux(east[i],u,cooling[i+1])
          +flux(north[i-n],cooling[i-n],u)-flux(north[i],u,cooling[i+n]))
          +diff*(cooling[i-1]+cooling[i+1]+cooling[i-n]+cooling[i+n]-4*u);
      }
      next[inj] += adv*injectionRate*(c.temperature-c.injection);
      next[prod] -= adv*rate*cooling[prod];
      [cooling,next]=[next,cooling];
    }
    hours+=4383;
    injectedVolume+=4383*injectionRate;
    // First-order isenthalpic liquid-water response to production drawdown.
    // Estimate thermal expansion from a freshwater density correlation (°C).
    const reservoirT = c.temperature-cooling[prod];
    const density = t => 1000*(1-(t+288.9414)*(t-3.9863)**2/(508929.2*(t+68.12963)));
    const rho = density(reservoirT);
    const expansion = -(density(reservoirT+.01)-density(reservoirT-.01))/(.02*rho);
    const pressureHeating = (1-expansion*(reservoirT+273.15))*drawdown*1e5/(rho*4180);
    history.push({day:hours/24,rate,temperature:reservoirT+pressureHeating,deltaP});
    if (season%2) frames.push(cooling.slice());
  }
  return {frames,history};
}
