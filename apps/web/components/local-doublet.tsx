"use client";

import { useEffect, useRef, useState } from "react";

type Case = {
  depth: number;
  thickness: number;
  porosity: number;
  permeability: number;
  temperature: number;
  injection: number;
  pressure_window: number;
  spacing: number;
  extent: number;
  resolution: number;
  azimuth: number;
  years: number;
  winter: number;
  summer: number;
};
type Run = {
  case: Case;
  n: number;
  wells: number[][];
  frames: string[];
  history: number[][];
};
type Entry = { name: string; run: Run; capex: number; site: string };
const api = process.env.NEXT_PUBLIC_DOUBLET_API;
const modes = ["steady", "seasonal", "higher"] as const;

function cash(
  run: Run,
  initial: number,
  tariff: number,
  electricity: number,
  fixed: number,
  discount: number,
  demand: number,
) {
  const rows = Array.from({ length: run.case.years }, () => ({
    heat: 0,
    power: 0,
    cash: 0,
    temp: run.case.temperature,
    flow: 0,
    target: 0,
  }));
  let previous = 0;
  for (const [day, kelvin, volume, pin, pout] of run.history) {
    const hours = (day - previous) * 24;
    previous = day;
    if (hours <= 0) continue;
    const year = Math.min(rows.length - 1, Math.ceil(day / 365.25 - 1e-10) - 1);
    const row = rows[Math.max(0, year)];
    const rate = Math.max(0, -volume / 24);
    const mw =
      (rate * 4.18 * Math.max(0, kelvin - 273.15 - run.case.injection)) / 3600;
    row.heat += Math.min(demand, mw) * hours;
    row.power +=
      (((rate / 3600) * Math.max(0, pin - pout) * 0.1) / 0.72) * hours;
    row.temp = kelvin - 273.15;
    row.flow += (rate * hours) / (365.25 * 24);
    row.target +=
      ((day - year * 365.25 <= 365.25 / 2 + 1e-8
        ? run.case.winter
        : run.case.summer) *
        hours) /
      (365.25 * 24);
  }
  let npv = -initial;
  for (const [i, row] of rows.entries()) {
    row.cash = (row.heat * tariff - row.power * electricity) / 1e6 - fixed;
    npv += row.cash / (1 + discount / 100) ** (i + 1);
  }
  return { rows, npv };
}

function Field({
  label,
  value,
  onChange,
  step = "any",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        required
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}

function Plume({ run, year }: { run: Run; year: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    const { n } = run;
    const raw = year ? atob(run.frames[year - 1]) : "";
    const image = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = year
        ? ((raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)) << 16) >>
          16
        : 0;
      const f = Math.min(
        1,
        Math.max(0, v / 10 / (run.case.temperature - run.case.injection)),
      );
      const offset = ((n - 1 - Math.floor(i / n)) * n + (i % n)) * 4;
      image.data.set([239 - 208 * f, 208 - 109 * f, 143 + 24 * f, 255], offset);
    }
    ctx.putImageData(image, 0, 0);
  }, [run, year]);
  return (
    <div className="doublet-map">
      <canvas
        ref={ref}
        width={run.n}
        height={run.n}
        aria-label={"Reservoir cooling in year " + year}
      />
      {run.wells.map(([x, y], i) => (
        <span
          key={i}
          style={{
            left: ((x + 0.5) / run.n) * 100 + "%",
            top: (1 - (y + 0.5) / run.n) * 100 + "%",
          }}
        >
          {i ? "P" : "I"}
        </span>
      ))}
      <small>N ↑</small>
    </div>
  );
}

export function LocalDoublet({
  seed,
  site,
  capex,
  onSelectCell,
}: {
  seed: Case;
  site: string;
  capex: number;
  onSelectCell: () => void;
}) {
  const resultsPanel = useRef<HTMLElement>(null);
  const [completed, setCompleted] = useState(0);
  useEffect(()=>{if(completed) resultsPanel.current?.scrollIntoView({block:"start"});},[completed]);
  const [endpoint, setEndpoint] = useState(api || "");
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const [settings, setSettings] = useState(seed);
  const [mode, setMode] = useState<(typeof modes)[number]>("steady");
  const [runs, setRuns] = useState<Entry[]>([]);
  const [index, setIndex] = useState(0);
  const [year, setYear] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tariff, price] = useState(60),
    [electricity, powerPrice] = useState(100),
    [fixed, opex] = useState(0.25),
    [discount, setDiscount] = useState(5),
    [demand, setDemand] = useState(15);
  const [capital, setCapital] = useState(capex);
  const active = runs[index];
  const yr = active ? Math.min(year, active.run.case.years) : 0;
  useEffect(() => {
    const saved = sessionStorage.getItem("doublet-solver-url");
    if (saved) setEndpoint(saved);
    else if (!api && ["localhost", "127.0.0.1"].includes(window.location.hostname))
      setEndpoint("http://127.0.0.1:8001");
  }, []);
  useEffect(() => {
    if (!playing || !active) return;
    const timer = window.setInterval(
      () => setYear((v) => (v + 1) % (active.run.case.years + 1)),
      450,
    );
    return () => window.clearInterval(timer);
  }, [playing, active]);
  const field = (key: keyof Case, label: string) => (
    <Field
      key={key}
      label={label}
      value={settings[key]}
      onChange={(v) => setSettings({ ...settings, [key]: v })}
    />
  );
  async function execute(engine: "browser" | "example" | "darts") {
    setPlaying(false);
    setBusy(true);
    setError("");
    try {
      if (engine === "example") {
        const entries = await Promise.all(
          modes.map(async (name) => {
            const res = await fetch((process.env.NEXT_PUBLIC_BASE_PATH || "") + "/data/doublet-" + name + ".json.gz");
            if (!res.ok || !res.body)
              throw new Error("Could not load the Gassum example.");
            const run = (await new Response(
              res.body.pipeThrough(new DecompressionStream("gzip")),
            ).json()) as Run & { capex: number; lat: number; lon: number };
            return {
              name,
              run,
              capex: run.capex,
              site: "Gassum example · " + run.lat + "° N, " + run.lon + "° E",
            };
          }),
        );
        setRuns(entries);
        setIndex(0);
        setCapital(entries[0].capex);
      } else {
        let data: Run;
        if (engine === "browser") {
          data = await new Promise<Run>((resolve,reject)=>{
            const task = new Worker((process.env.NEXT_PUBLIC_BASE_PATH || "") + "/doublet-worker.mjs", {type:"module"});
            worker.current = task;
            task.onmessage = ({data})=>data.error ? reject(new Error(data.error)) : resolve(data.result);
            task.onerror = ()=>reject(new Error("Could not start the browser solver. Reload and retry."));
            task.postMessage(settings);
          });
        } else {
        const url = new URL(endpoint);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname)))
          throw new Error("Use an HTTPS solver address or a local workstation address.");
        if (url.username || url.password || url.search || url.hash) throw new Error("Enter the base URL without credentials, a query or a fragment.");
        const base = url.href.replace(/\/+$/, "");
        const res = await fetch(base + "/v1/doublet/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        });
        const response = (await res.json()) as Run & {
          detail?: string | { msg: string }[];
        };
        if (!res.ok)
          throw new Error(
            typeof response.detail === "string"
              ? response.detail
              : response.detail?.[0]?.msg || "Run failed.",
          );
        data = response;
        }
        const prior = runs.filter((r) => r.site === site);
        setRuns([...prior, { name: mode + (engine === "browser" ? " · 2D screening" : " · open-DARTS"), run: data, capex, site }]);
        setIndex(prior.length);
        if (!prior.length) setCapital(capex);
      }
      setYear(engine === "example" ? 1 : settings.years);
      setCompleted(v=>v+1);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Could not reach the solver. Check its URL, network access and allowed website origins."
          : String(e),
      );
    } finally {
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
    }
  }
  const changeMode = (m: typeof mode) => {
    setMode(m);
    setSettings({
      ...settings,
      winter: seed.winter * (m === "steady" ? 1 : 1.4),
      summer: seed.winter * (m === "seasonal" ? 0.6 : m === "higher" ? 1.4 : 1),
    });
  };
  const comparisons = runs.map((r) =>
    cash(r.run, capital, tariff, electricity, fixed, discount, demand),
  );
  const row = yr ? comparisons[index].rows[yr - 1] : null;
  return (
    <section className="doublet-dialog">
      <header>
        <h2>Doublet simulator</h2>
        <button onClick={onSelectCell} type="button">
          Change map cell
        </button>
      </header>
      <p>{site} · Uniform reservoir properties across the local grid.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute("browser");
        }}
      >
        <h3>Local grid and reservoir</h3><p>Design spacing starts at 1,250 m unless you enter a spacing in DoubletCalc1D. Wells snap to local cell centres.</p>
        <div className="doublet-fields">
          {field("extent", "Domain width (m)")}
          {field("resolution", "Cell width (m)")}
          {field("spacing", "Well spacing (m)")}
          {field("azimuth", "Azimuth I → P (° from N)")}
          {field("depth", "Top depth (m)")}
          {field("thickness", "Net thickness (m)")}
          {field("porosity", "Porosity (fraction)")}
          {field("permeability", "Permeability (mD)")}
          {field("temperature", "Reservoir (°C)")}
          {field("injection", "Injection (°C)")}
        </div>
        <h3>Pumping schedule</h3>
        <div className="doublet-fields">
          <label>
            Preset
            <select
              value={mode}
              onChange={(e) => changeMode(e.target.value as typeof mode)}
            >
              {modes.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {field("winter", "Winter target (m³/h)")}
          {field("summer", "Summer target (m³/h)")}
          {field("pressure_window", "Total BHP window (bar)")}
          {field("years", "Duration (years)")}
        </div>
        <p>
          Each season spans half a year. The pressure window is split equally
          about initial hydrostatic pressure. Wells snap to local cell centres.
        </p>
        <h3>Run scenarios</h3>
        <p>2D screening calculates the cold front on this device. Open-DARTS is available as an optional external solver.</p>
        <details><summary>Optional open-DARTS service</summary>
        <label>open-DARTS API URL
          <input type="url" placeholder="https://your-solver.example.org" value={endpoint}
            onChange={e=>{setEndpoint(e.target.value);sessionStorage.setItem("doublet-solver-url", e.target.value);}} />
        </label>
        </details>
        <div className="doublet-actions">
          <button disabled={busy}>{busy ? "Calculating…" : "Run 2D screening in browser"}</button>
          {endpoint.trim() && <button type="button" disabled={busy} onClick={()=>execute("darts")}>
            {busy ? "Working…" : "Run open-DARTS"}
          </button>}
          <button type="button" disabled={busy} onClick={() => execute("example")}>
            Load Gassum example · 3 scenarios
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
      {active && (
        <section ref={resultsPanel} style={{scrollMarginTop:"80px"}}>
          <h3>Simulation results · Run {index+1}</h3>
          <p aria-live="polite">{active.name} · {active.run.case.spacing} m requested spacing · {active.run.case.years} years · NPV <strong>€{comparisons[index].npv.toFixed(2)} M</strong></p>
          <p>
            {active.site} · {active.run.n} × {active.run.n} cells ·{" "}
            {active.run.case.resolution} m resolution
          </p>
          <label>
            Displayed run{" "}
            <select value={index} onChange={(e) => setIndex(+e.target.value)}>
              {runs.map((r, i) => (
                <option key={i} value={i}>
                  {i + 1}. {r.name} · {r.run.case.winter.toFixed(1)} /{" "}
                  {r.run.case.summer.toFixed(1)} m³/h · {r.run.case.spacing} m
                </option>
              ))}
            </select>
          </label>
          <div className="doublet-results">
            <div>
              <Plume run={active.run} year={yr} />
              <p>
                I injector · P producer · Width {active.run.case.extent / 1000}{" "}
                km
                <br />
                Sand = initial temperature · Blue = injection temperature
              </p>
            </div>
            <div>
              <label>
                Year {yr}
                <input
                  type="range"
                  min={0}
                  max={active.run.case.years}
                  value={yr}
                  onChange={(e) => setYear(+e.target.value)}
                />
              </label>
              <button type="button" onClick={() => setPlaying(!playing)}>
                {playing ? "Pause" : "Play cold front"}
              </button>
              <p>
                Producer temperature{" "}
                <strong>
                  {(row?.temp ?? active.run.case.temperature).toFixed(1)} °C
                </strong>
              </p>
              {row && (
                <>
                  <p>
                    Mean flow · achieved / requested{" "}
                    <strong>
                      {row.flow.toFixed(1)} / {row.target.toFixed(1)} m³/h
                    </strong>
                  </p>
                  <p>
                    Delivered heat{" "}
                    <strong>{Math.round(row.heat).toLocaleString()} MWh</strong>
                  </p>
                  <p>
                    Pumping electricity{" "}
                    <strong>
                      {Math.round(row.power).toLocaleString()} MWh
                    </strong>
                  </p>
                  <p>
                    Annual operating cash flow{" "}
                    <strong>€{row.cash.toFixed(2)} M</strong>
                  </p>
                </>
              )}
            </div>
          </div>
          <h3>Year-end producer temperature (°C)</h3>
          <svg
            viewBox="0 0 600 115"
            width="100%"
            role="img"
            aria-label="Year-end producer temperature for the displayed scenario"
          >
            {(() => {
              const values = comparisons[index].rows.map((y) => y.temp);
              const low = Math.min(...values)-0.1,
                high = Math.max(...values)+0.1;
              const y = (v: number) =>
                95 - (80 * (v - low)) / (high - low || 1);
              const x = (i: number) =>
                45 + (540 * i) / Math.max(1, values.length - 1);
              return (
                <>
                  <line x1="45" x2="585" y1="95" y2="95" stroke="#aaa" />
                  <text x="0" y="17" fontSize="12">
                    {high.toFixed(2)}
                  </text>
                  <text x="0" y="95" fontSize="12">
                    {low.toFixed(2)}
                  </text>
                  <polyline
                    fill="none"
                    stroke="#a04a30"
                    strokeWidth="3"
                    points={values.map((v, i) => x(i) + "," + y(v)).join(" ")}
                  />
                  {!!yr && (
                    <circle
                      cx={x(yr - 1)}
                      cy={y(values[yr - 1])}
                      r="4"
                      fill="#a84227"
                    />
                  )}
                  <text x="45" y="112" fontSize="12">
                    Year 1
                  </text>
                  <text x="585" y="112" textAnchor="end" fontSize="12">
                    Year {values.length}
                  </text>
                </>
              );
            })()}
          </svg>
          <h3>Annual operating cash flow (M€)</h3>
          <svg
            viewBox="0 0 600 115"
            width="100%"
            role="img"
            aria-label="Annual operating cash flow for the displayed scenario"
          >
            {(() => {
              const values = comparisons[index].rows.map((y) => y.cash);
              const low = Math.min(0, ...values),
                high = Math.max(0, ...values);
              const y = (v: number) =>
                95 - (80 * (v - low)) / (high - low || 1);
              const x = (i: number) =>
                45 + (540 * i) / Math.max(1, values.length - 1);
              return (
                <>
                  <line x1="45" x2="585" y1={y(0)} y2={y(0)} stroke="#aaa" />
                  <text x="0" y="17" fontSize="12">
                    {high.toFixed(2)}
                  </text>
                  <text x="0" y="95" fontSize="12">
                    {low.toFixed(2)}
                  </text>
                  <polyline
                    fill="none"
                    stroke="#195a58"
                    strokeWidth="3"
                    points={values.map((v, i) => x(i) + "," + y(v)).join(" ")}
                  />
                  {!!yr && (
                    <circle
                      cx={x(yr - 1)}
                      cy={y(values[yr - 1])}
                      r="4"
                      fill="#a84227"
                    />
                  )}
                  <text x="45" y="112" fontSize="12">
                    Year 1
                  </text>
                  <text x="585" y="112" textAnchor="end" fontSize="12">
                    Year {values.length}
                  </text>
                </>
              );
            })()}
          </svg>
          <h3>Shared economic assumptions</h3>
          <div className="doublet-fields">
            <Field label="Heat (€/MWh)" value={tariff} onChange={price} />
            <Field
              label="Electricity (€/MWh)"
              value={electricity}
              onChange={powerPrice}
            />
            <Field label="Fixed OPEX (M€/yr)" value={fixed} onChange={opex} />
            <Field label="CAPEX (M€)" value={capital} onChange={setCapital} />
            <Field
              label="Discount (%)"
              value={discount}
              onChange={setDiscount}
            />
            <Field
              label="Heat demand cap (MW)"
              value={demand}
              onChange={setDemand}
            />
          </div>
          <p>
            Direct heat screening. Pump efficiency 72%, reservoir pressure
            losses only. Tariffs, demand and fixed OPEX are illustrative.
          </p>
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>1 °C cooling¹</th>
                <th>Lifetime heat</th>
                <th>NPV</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((r, i) => {
                const first = r.rows.findIndex(
                  (y) => y.temp <= runs[i].run.case.temperature - 1,
                );
                return (
                  <tr key={i} aria-current={i===index ? "true" : undefined} className={i===index ? "displayed-run" : undefined}>
                    <td>
                      {i + 1}. {runs[i].name} · {runs[i].run.case.spacing} m
                    </td>
                    <td>{first < 0 ? "Beyond run" : "Year " + (first + 1)}</td>
                    <td>
                      {(r.rows.reduce((a, y) => a + y.heat, 0) / 1000).toFixed(
                        1,
                      )}{" "}
                      GWh
                    </td>
                    <td>€{r.npv.toFixed(2)} M</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>
            ¹ Evaluated at year end. Pure water, single layer, open lateral
            boundary approximation, insulated top and base.
          </p>
        </section>
      )}
    </section>
  );
}
