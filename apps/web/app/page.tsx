"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Box, Building2, Calculator, Database, Factory, Flame, Layers3, LoaderCircle, LockKeyhole, Map as MapIcon, MapPin, Mountain, RotateCcw, Search, Sigma, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Geology3DViewer } from "@/components/geology-3d-viewer";
import { ModelBuilder } from "@/components/model-builder";
import { CulturalData, GeothermalMap } from "@/components/geothermal-map";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PropertyKey = "top_depth" | "thickness_mean" | "ntg" | "porosity" | "permeability" | "temperature" | "transmissivity" | "confidence";
type Point = Record<PropertyKey | "lon" | "lat" | "valid_mask" | "ntg" | "well_support", number>;
type Reservoir = { id: string; name: string; assessment_type: "ates" | "deep_geothermal"; status: string; points: Point[] };
type Well = { name: string; lon: number; lat: number; role: "conditioning" | "tops_only" };
type Model = { model_version: string; disclaimer: string; reservoirs: Reservoir[]; wells: Well[] };
type ThermoPropertyKey = "power" | "heat_pump_power" | "flow_rate" | "prd_temp" | "inj_temp" | "pres" | "welld" | "capex" | "opex" | "utc" | "npv" | "hprod" | "cop" | "cophp" | "transmissivity_with_ntg" | "thickness" | "permeability" | "transmissivity";
type ThermoPoint = { lon: number; lat: number; valid_mask: number } & Record<string, number>;
type ThermoReservoir = { id: string; name: string; assessment_type: "ates" | "deep_geothermal"; points: ThermoPoint[] };
type ThermoModel = { model_version: string; engine: string; percentiles: number[]; grid_spacing_m: number; reservoirs: ThermoReservoir[] };
type CalcInputs = { permeability: number; thickness: number; ntg: number; temperature: number; injectionTemperature: number; spacing: number; pressure: number };
type SearchResult = { display_name: string; lat: string; lon: string };

const properties: Record<PropertyKey, { label: string; unit: string; digits: number; palette: string[] }> = {
  top_depth: { label: "Top depth", unit: "m bMSL", digits: 0, palette: ["#f3d9a4", "#c98655", "#723f45", "#24263d"] },
  thickness_mean: { label: "Gross thickness", unit: "m", digits: 0, palette: ["#e8efe3", "#9bc49c", "#407f73", "#173c49"] },
  ntg: { label: "Net-to-gross", unit: "fraction", digits: 2, palette: ["#f2ead0", "#dbca72", "#a6843f", "#594427"] },
  porosity: { label: "Porosity", unit: "fraction", digits: 2, palette: ["#f3ebc8", "#dbb865", "#c96c4a", "#6d3045"] },
  permeability: { label: "Permeability", unit: "mD", digits: 0, palette: ["#e8f0dd", "#a8ce79", "#4a9a6b", "#14566c"] },
  temperature: { label: "Temperature", unit: "°C", digits: 1, palette: ["#f5dda2", "#ef9d4b", "#c94c44", "#662f4b"] },
  transmissivity: { label: "Transmissivity", unit: "Dm", digits: 1, palette: ["#e5f1df", "#8fc79a", "#32908c", "#17485d"] },
  confidence: { label: "Model confidence", unit: "score", digits: 2, palette: ["#434958", "#736f5b", "#b39b52", "#e8d17f"] },
};

const thermoProperties: Record<ThermoPropertyKey, { label: string; unit: string; digits: number; palette: string[] }> = {
  power: { label: "Geothermal power", unit: "MW", digits: 1, palette: ["#f2ecd4", "#e2c25c", "#d7793e", "#7a2f45"] },
  heat_pump_power: { label: "Heat incl. heat pump", unit: "MW", digits: 1, palette: ["#eef0d0", "#bfc85c", "#669a58", "#245461"] },
  flow_rate: { label: "Optimal flow rate", unit: "m³/h", digits: 0, palette: ["#e5f0ee", "#88c6bd", "#328f96", "#185268"] },
  prd_temp: { label: "Production temperature", unit: "°C", digits: 1, palette: ["#f5dda2", "#ef9d4b", "#c94c44", "#662f4b"] },
  inj_temp: { label: "Injection temperature", unit: "°C", digits: 1, palette: ["#e6f0f2", "#8fc8d7", "#4387aa", "#2d466c"] },
  pres: { label: "Required pump pressure", unit: "bar", digits: 1, palette: ["#edf0d8", "#b8c679", "#668c6d", "#34515a"] },
  welld: { label: "Optimal well spacing", unit: "m", digits: 0, palette: ["#f0e7d7", "#d2ad68", "#a26649", "#5c3a49"] },
  capex: { label: "CAPEX", unit: "M€", digits: 1, palette: ["#e7ede7", "#a7bf9e", "#698878", "#414b57"] },
  opex: { label: "Annual OPEX", unit: "M€/yr", digits: 2, palette: ["#f0e9dc", "#d6b47f", "#a66f63", "#65455a"] },
  utc: { label: "Unit technical cost", unit: "ct/kWh", digits: 1, palette: ["#e8eedf", "#b7ca84", "#758d5d", "#435348"] },
  npv: { label: "Net present value", unit: "M€", digits: 1, palette: ["#dfebea", "#8cbcb1", "#4f8580", "#3d4f62"] },
  hprod: { label: "Annual heat production", unit: "TJ/yr", digits: 0, palette: ["#f1e8cd", "#dfc15f", "#c47a43", "#6f3946"] },
  cop: { label: "Direct extraction COP", unit: "ratio", digits: 1, palette: ["#ecebd4", "#c7c36a", "#809451", "#3f5b55"] },
  cophp: { label: "Heat-pump COP", unit: "ratio", digits: 1, palette: ["#e2eeee", "#91c1c2", "#518b9b", "#33516a"] },
  transmissivity_with_ntg: { label: "Net transmissivity", unit: "Dm", digits: 1, palette: ["#e5f1df", "#8fc79a", "#32908c", "#17485d"] },
  thickness: { label: "Simulated thickness", unit: "m", digits: 0, palette: ["#e8efe3", "#9bc49c", "#407f73", "#173c49"] },
  permeability: { label: "Simulated permeability", unit: "mD", digits: 0, palette: ["#e8f0dd", "#a8ce79", "#4a9a6b", "#14566c"] },
  transmissivity: { label: "Simulated transmissivity", unit: "mD·m", digits: 0, palette: ["#e5f1df", "#8fc79a", "#32908c", "#17485d"] },
};

function fmt(value: number, key: PropertyKey) {
  return value.toLocaleString("en-GB", { minimumFractionDigits: properties[key].digits, maximumFractionDigits: properties[key].digits });
}

function thermoField(key: ThermoPropertyKey, percentile: number) { return `${key}_p${percentile}`; }
function thermoFmt(value: number, key: ThermoPropertyKey) { return value.toLocaleString("en-GB", { minimumFractionDigits: thermoProperties[key].digits, maximumFractionDigits: thermoProperties[key].digits }); }

function defaults(point: Point | null, thermo: ThermoPoint | null = null): CalcInputs {
  return {
    permeability: Math.round(thermo?.permeability_p50 ?? point?.permeability ?? 100), thickness: Math.round(thermo?.thickness_p50 ?? point?.thickness_mean ?? 50),
    ntg: Number((point?.ntg ?? .55).toFixed(2)), temperature: Number((thermo?.prd_temp_p50 ?? point?.temperature ?? 55).toFixed(1)),
    injectionTemperature: Number((thermo?.inj_temp_p50 ?? 25).toFixed(1)), spacing: Math.round(thermo?.welld_p50 ?? 1200), pressure: Number((thermo?.pres_p50 ?? 45).toFixed(1)),
  };
}

export default function Home() {
  const [workspace, setWorkspace] = useState<"demo" | "build">("demo");
  const [model, setModel] = useState<Model | null>(null);
  const [thermoModel, setThermoModel] = useState<ThermoModel | null>(null);
  const [culturalData, setCulturalData] = useState<CulturalData | null>(null);
  const [reservoirId, setReservoirId] = useState("gassum");
  const [property, setProperty] = useState<PropertyKey>("temperature");
  const [thermoProperty, setThermoProperty] = useState<ThermoPropertyKey>("power");
  const [percentile, setPercentile] = useState(50);
  const [workflow, setWorkflow] = useState<"geology" | "pythermogis" | "doublet" | "market">("geology");
  const [selected, setSelected] = useState<Point | null>(null);
  const [selectedThermo, setSelectedThermo] = useState<ThermoPoint | null>(null);
  const [showTopography, setShowTopography] = useState(true);
  const [showDistrictHeating, setShowDistrictHeating] = useState(true);
  const [showHeatDelivery, setShowHeatDelivery] = useState(true);
  const [showIndustry, setShowIndustry] = useState(true);
  const [showHeatPlants, setShowHeatPlants] = useState(true);
  const [calc, setCalc] = useState<CalcInputs>(defaults(null));
  const [address, setAddress] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [focusLocation, setFocusLocation] = useState<{ lon: number; lat: number; label: string; zoom: number } | null>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const searchCache = useRef(new globalThis.Map<string, SearchResult[]>());
  const lastSearch = useRef(0);

  useEffect(() => {
    Promise.all([
      fetch("/data/model-preview.json").then((r) => r.json() as Promise<Model>),
      fetch("/data/pythermogis-preview.json").then((r) => r.json() as Promise<ThermoModel>),
      fetch("/data/cultural-data.json").then((r) => r.json() as Promise<CulturalData>),
    ]).then(([geology, thermo, cultural]) => {
      setModel(geology); setThermoModel(thermo); setCulturalData(cultural);
      const initial = geology.reservoirs.find((r) => r.id === "gassum")!;
      const point = initial.points[Math.floor(initial.points.length / 2)];
      const thermoReservoir = thermo.reservoirs.find((r) => r.id === "gassum");
      const thermoPoint = thermoReservoir?.points[Math.floor(thermoReservoir.points.length / 2)] ?? null;
      setSelected(point); setSelectedThermo(thermoPoint); setCalc(defaults(point, thermoPoint));
    });
  }, []);

  const reservoir = model?.reservoirs.find((item) => item.id === reservoirId);
  const thermoReservoir = thermoModel?.reservoirs.find((item) => item.id === reservoirId);
  const activeThermoField = thermoField(thermoProperty, percentile);
  const range = useMemo(() => {
    if (!reservoir) return [0, 1];
    const values = reservoir.points.filter((p) => p.valid_mask === 1).map((p) => p[property]).sort((a, b) => a - b);
    return [values[Math.floor(values.length * .03)] ?? 0, values[Math.floor(values.length * .97)] ?? 1];
  }, [reservoir, property]);
  const thermoRange = useMemo(() => {
    if (!thermoReservoir) return [0, 1];
    const fields = [10, 50, 90].map((casePercentile) => thermoField(thermoProperty, casePercentile));
    const values = thermoReservoir.points.flatMap((point) => point.valid_mask === 1 ? fields.map((field) => point[field]).filter(Number.isFinite) : []).sort((a, b) => a - b);
    return [values[Math.floor(values.length * .03)] ?? 0, values[Math.floor(values.length * .97)] ?? 1];
  }, [thermoReservoir, thermoProperty]);
  const stack = useMemo(() => {
    if (!model || !selected) return [];
    return model.reservoirs.map((item) => {
      let nearest = item.points[0], distance = Infinity;
      for (const point of item.points) {
        const d = (point.lon - selected.lon) ** 2 + (point.lat - selected.lat) ** 2;
        if (d < distance) { nearest = point; distance = d; }
      }
      return { reservoir: item, point: nearest };
    });
  }, [model, selected]);
  const thermoStack = useMemo(() => {
    if (!thermoModel || !selected) return [];
    return thermoModel.reservoirs.map((item) => {
      let nearest = item.points[0], distance = Infinity;
      for (const point of item.points) { const d = (point.lon - selected.lon) ** 2 + (point.lat - selected.lat) ** 2; if (d < distance) { nearest = point; distance = d; } }
      return { reservoir: item, point: nearest };
    });
  }, [thermoModel, selected]);
  const results = useMemo(() => {
    const k = Math.max(calc.permeability, .01) * 9.869233e-16;
    const netH = Math.max(calc.thickness * calc.ntg, .1);
    const meanTemperature = Math.max((calc.temperature + calc.injectionTemperature) / 2, 5);
    const viscosity = Math.max(.00022, .001 * Math.exp(-.033 * (meanTemperature - 20)));
    const rw = .11, re = Math.max(calc.spacing / 2, 10), dp = Math.max(calc.pressure, 1) * 1e5;
    const flow = Math.min(600, Math.max(0, (2 * Math.PI * k * netH * dp / (viscosity * Math.log(re / rw))) * 3600));
    const thermal = flow / 3600 * 1000 * 4180 * Math.max(calc.temperature - calc.injectionTemperature, 0) / 1e6;
    const pumping = flow / 3600 * dp / .72 / 1e6;
    return { flow, thermal, pumping, netH };
  }, [calc]);
  const chooseReservoir = (id: string) => {
    setReservoirId(id);
    const next = model?.reservoirs.find((r) => r.id === id);
    const nextThermo = thermoModel?.reservoirs.find((r) => r.id === id);
    if (next) { const point = next.points[Math.floor(next.points.length / 2)], thermoPoint = nextThermo?.points[Math.floor(nextThermo.points.length / 2)] ?? null; setSelected(point); setSelectedThermo(thermoPoint); setCalc(defaults(point, thermoPoint)); }
  };
  const nearestThermoPoint = (point: { lon: number; lat: number }) => {
    if (!thermoReservoir) return null;
    let nearest = thermoReservoir.points[0], distance = Infinity;
    for (const candidate of thermoReservoir.points) { const d = (candidate.lon - point.lon) ** 2 + (candidate.lat - point.lat) ** 2; if (d < distance) { nearest = candidate; distance = d; } }
    return nearest;
  };
  const nearestGeologyPoint = (point: { lon: number; lat: number }) => {
    if (!reservoir) return null;
    let nearest = reservoir.points[0], distance = Infinity;
    for (const candidate of reservoir.points) { const d = (candidate.lon - point.lon) ** 2 + (candidate.lat - point.lat) ** 2; if (d < distance) { nearest = candidate; distance = d; } }
    return nearest;
  };
  const selectPoint = (point: Point) => { const thermoPoint = nearestThermoPoint(point); setSelected(point); setSelectedThermo(thermoPoint); setCalc(defaults(point, thermoPoint)); };
  const selectThermoPoint = (point: ThermoPoint) => { const geologyPoint = nearestGeologyPoint(point); setSelectedThermo(point); setSelected(geologyPoint); setCalc(defaults(geologyPoint, point)); };
  const searchAddress = async (event: FormEvent) => {
    event.preventDefault();
    const query = address.trim();
    if (query.length < 3 || searching) return;
    setSearchMessage("");
    const key = query.toLocaleLowerCase("da-DK");
    const cached = searchCache.current.get(key);
    if (cached) { setSearchResults(cached); if (!cached.length) setSearchMessage("No Danish locations found."); return; }
    setSearching(true);
    const wait = Math.max(0, 1000 - (Date.now() - lastSearch.current));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSearch.current = Date.now();
    try {
      const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "5", countrycodes: "dk", addressdetails: "1", "accept-language": "da,en" });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      const results = await response.json() as SearchResult[];
      searchCache.current.set(key, results); setSearchResults(results);
      if (!results.length) setSearchMessage("No Danish locations found.");
    } catch {
      setSearchMessage("Address search is temporarily unavailable.");
    } finally { setSearching(false); }
  };
  const chooseAddress = (result: SearchResult) => {
    const location = { lon: Number(result.lon), lat: Number(result.lat), label: result.display_name, zoom: 14 };
    setFocusLocation(location); setAddress(result.display_name); setSearchResults([]); setSearchMessage("");
    if (reservoir) {
      let nearest = reservoir.points[0], distance = Infinity;
      for (const point of reservoir.points) { const d = (point.lon - location.lon) ** 2 + (point.lat - location.lat) ** 2; if (d < distance) { nearest = point; distance = d; } }
      if (nearest && distance < .00045) selectPoint(nearest);
    }
  };

  const showingThermo = workflow !== "geology";
  const mapPoints = showingThermo ? thermoReservoir?.points : reservoir?.points;
  const mapSelected = showingThermo ? selectedThermo : selected;
  const mapRange = showingThermo ? thermoRange : range;
  const mapProperty = showingThermo ? activeThermoField : property;
  const mapPalette = showingThermo ? thermoProperties[thermoProperty].palette : properties[property].palette;
  const mapLabel = workflow === "market" ? "Heat-market context · PyThermoGIS P50" : showingThermo ? `${thermoProperties[thermoProperty].label} · P${percentile}` : properties[property].label;
  const mapUnit = showingThermo ? thermoProperties[thermoProperty].unit : properties[property].unit;
  const supports3d = workflow === "geology" || workflow === "pythermogis";
  const showing3d = supports3d && viewMode === "3d";

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><Layers3 /></div><div><h1>DECODE</h1><p>Regional geothermal explorer</p></div>
      <div className="workspace-switch" role="group" aria-label="Workspace"><button className={workspace === "demo" ? "active" : ""} onClick={() => setWorkspace("demo")}><MapIcon /> Demo</button><button className={workspace === "build" ? "active" : ""} onClick={() => setWorkspace("build")}><Box /> Build Model</button></div>
      <div className="topbar-status"><span className="status-dot" /> Well-conditioned first pass <span className="topbar-divider" /> EPSG:23032</div>
    </header>

    {workspace === "build" ? <ModelBuilder /> : <>

    <aside className="control-panel">
      <Tabs value={workflow} onValueChange={(value) => { const next = value as "geology" | "pythermogis" | "doublet" | "market"; setWorkflow(next); if (next === "doublet" || next === "market") setViewMode("2d"); if (next === "market") { setThermoProperty("power"); setPercentile(50); } }} className="sidebar-tabs">
        <TabsList className="sidebar-tab-list"><TabsTrigger value="geology"><MapIcon /> Geology</TabsTrigger><TabsTrigger value="pythermogis"><Activity /> PyThermoGIS</TabsTrigger><TabsTrigger value="doublet"><Calculator /> DoubletCalc1D</TabsTrigger><TabsTrigger value="market"><Factory /> Heat market</TabsTrigger></TabsList>
        <TabsContent value="geology" className="sidebar-tab-content">
          <section><p className="eyebrow">Explore model</p><h2>Reservoir maps</h2><p className="panel-intro">Select an interval and cell. Topography and study wells keep the subsurface view geographically anchored.</p></section>
          <label className="field-label">Reservoir
            <NativeSelect value={reservoirId} onChange={(e) => chooseReservoir(e.target.value)} className="field-select">
              {model?.reservoirs.map((r) => <NativeSelectOption key={r.id} value={r.id}>{r.name}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="field-label">Map property
            <NativeSelect value={property} onChange={(e) => setProperty(e.target.value as PropertyKey)} className="field-select">
              {Object.entries(properties).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <button className={`layer-toggle ${showTopography ? "active" : ""}`} onClick={() => setShowTopography((value) => !value)}><Mountain /><span><strong>OpenStreetMap basemap</strong><small>{showTopography ? "Visible · roads, places and terrain" : "Hidden"}</small></span></button>
          {reservoir && <div className="reservoir-card"><div className="reservoir-card-top"><Database /><Badge variant="outline" className="model-badge">{reservoir.assessment_type === "ates" ? "ATES" : "Deep geothermal"}</Badge></div><strong>{reservoir.name}</strong><span>{reservoir.status.replace("_", " ")}</span></div>}
          <div className="notice"><Sigma /><p><strong>Evidence-aware properties</strong>Supplied formation tops and interpreted PHIE, PERM_GEUS and Vshale curves condition the priors near wells.</p></div>
        </TabsContent>
        <TabsContent value="pythermogis" className="sidebar-tab-content">
          <section><p className="eyebrow">Dynamic grid results</p><h2>PyThermoGIS</h2><p className="panel-intro">Explore stochastic doublet-performance outputs calculated for each 2 km model cell.</p></section>
          <label className="field-label">Reservoir
            <NativeSelect value={reservoirId} onChange={(e) => chooseReservoir(e.target.value)} className="field-select">
              {model?.reservoirs.map((r) => <NativeSelectOption key={r.id} value={r.id}>{r.name}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="field-label">Dynamic output
            <NativeSelect value={thermoProperty} onChange={(e) => setThermoProperty(e.target.value as ThermoPropertyKey)} className="field-select">
              {Object.entries(thermoProperties).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="field-label">Stochastic case
            <NativeSelect value={String(percentile)} onChange={(e) => setPercentile(Number(e.target.value))} className="field-select">
              <NativeSelectOption value="10">P10 · high case</NativeSelectOption><NativeSelectOption value="50">P50 · median case</NativeSelectOption><NativeSelectOption value="90">P90 · low case</NativeSelectOption>
            </NativeSelect>
          </label>
          <button className={`layer-toggle ${showTopography ? "active" : ""}`} onClick={() => setShowTopography((value) => !value)}><Mountain /><span><strong>OpenStreetMap basemap</strong><small>{showTopography ? "Visible · roads, places and terrain" : "Hidden"}</small></span></button>
          <div className="reservoir-card"><div className="reservoir-card-top"><Activity /><Badge variant="outline" className="model-badge">P{percentile}</Badge></div><strong>{thermoProperties[thermoProperty].label}</strong><span>{thermoModel?.engine ?? "Loading engine"} · {thermoModel?.grid_spacing_m?.toLocaleString("en-GB") ?? "—"} m grid</span></div>
          <div className="notice"><Sigma /><p><strong>Shared P10–P90 colour scale</strong>Each output keeps one fixed range across all three cases, so colour changes show the impact of uncertainty directly.</p></div>
        </TabsContent>
        <TabsContent value="doublet" className="sidebar-tab-content">
          <section><p className="eyebrow">Refine selected cell</p><h2>DoubletCalc1D</h2><p className="panel-intro">PyThermoGIS P50 outputs populate the inputs. Adjust them for a site-specific sensitivity check.</p></section>
          {selectedThermo && <div className="calc-results pythermo-baseline"><p className="eyebrow">PyThermoGIS P50 baseline</p><Result label="Flow rate" value={thermoFmt(selectedThermo.flow_rate_p50, "flow_rate")} unit="m³/h" /><Result label="Thermal power" value={thermoFmt(selectedThermo.power_p50, "power")} unit="MW" featured /><Result label="Pump pressure" value={thermoFmt(selectedThermo.pres_p50, "pres")} unit="bar" /><Result label="Well spacing" value={thermoFmt(selectedThermo.welld_p50, "welld")} unit="m" /></div>}
          <div className="calc-form">
            <CalcField label="Permeability" unit="mD" value={calc.permeability} setValue={(v) => setCalc({ ...calc, permeability: v })} />
            <CalcField label="Gross thickness" unit="m" value={calc.thickness} setValue={(v) => setCalc({ ...calc, thickness: v })} />
            <CalcField label="Net-to-gross" unit="fraction" value={calc.ntg} step={.01} setValue={(v) => setCalc({ ...calc, ntg: v })} />
            <CalcField label="Production temperature" unit="°C" value={calc.temperature} step={.1} setValue={(v) => setCalc({ ...calc, temperature: v })} />
            <CalcField label="Injection temperature" unit="°C" value={calc.injectionTemperature} setValue={(v) => setCalc({ ...calc, injectionTemperature: v })} />
            <CalcField label="Well spacing" unit="m" value={calc.spacing} setValue={(v) => setCalc({ ...calc, spacing: v })} />
            <CalcField label="Pressure window" unit="bar" value={calc.pressure} setValue={(v) => setCalc({ ...calc, pressure: v })} />
          </div>
          <button className="reset-button" onClick={() => setCalc(defaults(selected, selectedThermo))}><RotateCcw /> Reset to PyThermoGIS P50</button>
          <div className="calc-results"><p className="eyebrow">Screening result</p><Result label="Flow rate" value={results.flow.toFixed(0)} unit="m³/h" /><Result label="Thermal power" value={results.thermal.toFixed(1)} unit="MWth" featured /><Result label="Pump power" value={results.pumping.toFixed(2)} unit="MWe" /><Result label="Net reservoir" value={results.netH.toFixed(1)} unit="m" /></div>
          <p className="calc-caveat">The baseline is the completed stochastic grid run. Edited values use the browser’s analytical radial-flow response for immediate sensitivity screening.</p>
        </TabsContent>
        <TabsContent value="market" className="sidebar-tab-content">
          <section><p className="eyebrow">Cultural and energy context</p><h2>Heat market</h2><p className="panel-intro">Compare the PyThermoGIS P50 resource with existing heat infrastructure and candidate users.</p></section>
          <label className="field-label">Reservoir below market layers
            <NativeSelect value={reservoirId} onChange={(e) => chooseReservoir(e.target.value)} className="field-select">
              {model?.reservoirs.map((r) => <NativeSelectOption key={r.id} value={r.id}>{r.name}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <div className="market-layer-list">
            <button className={`layer-toggle ${showDistrictHeating ? "active" : ""}`} onClick={() => setShowDistrictHeating((value) => !value)}><Flame /><span><strong>District-heating areas</strong><small>{culturalData?.summary.district_heating_areas ?? "—"} official supply areas</small></span></button>
            <button className={`layer-toggle ${showHeatDelivery ? "active" : ""}`} onClick={() => setShowHeatDelivery((value) => !value)}><Activity /><span><strong>2024 network heat delivery</strong><small>Orange intensity · TJ delivered</small></span></button>
            <button className={`layer-toggle ${showIndustry ? "active" : ""}`} onClick={() => setShowIndustry((value) => !value)}><Building2 /><span><strong>Industrial candidates</strong><small>{culturalData?.summary.industrial_candidates ?? "—"} PRTR facilities</small></span></button>
            <button className={`layer-toggle ${showHeatPlants ? "active" : ""}`} onClick={() => setShowHeatPlants((value) => !value)}><Factory /><span><strong>Heat-production plants</strong><small>{culturalData?.summary.heat_plants ?? "—"} PRTR facilities</small></span></button>
            <div className="layer-toggle locked"><LockKeyhole /><span><strong>Building heat-demand density</strong><small>Requires Datafordeler BBR access</small></span></div>
          </div>
          <div className="notice market-notice"><Sigma /><p><strong>Screening context</strong>Network delivery is a demand proxy—not building-level demand. Click facility symbols or network centres for source details.</p></div>
        </TabsContent>
      </Tabs>
    </aside>

    <section className="map-panel" aria-label="Regional geothermal model map">
      <div className="map-heading"><div><p>{reservoir?.name ?? "Loading model"}</p><h2>{showing3d ? workflow === "pythermogis" ? `3D ${thermoProperties[thermoProperty].label} · P${percentile}` : `3D ${properties[property].label}` : mapLabel}</h2></div>{supports3d ? <div className="view-mode-switch" role="group" aria-label="Viewer mode"><button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")}><MapIcon /> 2D map</button><button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")}><Box /> 3D model</button></div> : <Badge variant="outline" className="engine-badge">{thermoModel?.engine ?? "PyThermoGIS"} · P{percentile}</Badge>}<div className="coordinate-readout"><MapPin />{selected ? `${selected.lat.toFixed(4)}° N, ${selected.lon.toFixed(4)}° E` : "Select a grid cell"}</div></div>
      <div className="map-canvas">
        {!showing3d ? <>{mapPoints && model ? <GeothermalMap points={mapPoints} wells={model.wells} selected={mapSelected} range={mapRange} property={mapProperty} palette={mapPalette} showBasemap={showTopography} focusLocation={focusLocation} cultural={workflow === "market" ? culturalData : null} showDistrictHeating={showDistrictHeating} showHeatDelivery={showHeatDelivery} showIndustry={showIndustry} showHeatPlants={showHeatPlants} onSelect={(point) => showingThermo ? selectThermoPoint(point as ThermoPoint) : selectPoint(point as Point)} /> : <div className="loading-state">Preparing regional model…</div>}
        <div className="address-search">
          <form onSubmit={searchAddress}><Search /><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Search a Danish address or place" aria-label="Search a Danish address or place" /><button disabled={searching || address.trim().length < 3}>{searching ? <LoaderCircle className="search-spinner" /> : "Find"}</button></form>
          {(searchResults.length > 0 || searchMessage) && <div className="search-results">{searchResults.map((result) => <button key={`${result.lat}-${result.lon}`} onClick={() => chooseAddress(result)}><MapPin /><span>{result.display_name}</span></button>)}{searchMessage && <p>{searchMessage}</p>}<small>Search © OpenStreetMap contributors</small></div>}
        </div>
        <div className="north-arrow">N<span /></div>
        <div className="map-key"><span><i className="conditioning-dot" /> Petrophysical well</span><span><i className="tops-dot" /> Tops-only well</span><span><Waves /> Depth referenced to MSL</span></div>
        <div className="legend"><div className="legend-ramp" style={{ background: `linear-gradient(90deg,${mapPalette.join(",")})` }} /><div><span>{showingThermo ? thermoFmt(mapRange[0], thermoProperty) : fmt(mapRange[0], property)}</span><strong>{mapUnit}</strong><span>{showingThermo ? thermoFmt(mapRange[1], thermoProperty) : fmt(mapRange[1], property)}</span></div>{showingThermo && <small>Fixed P10–P90 scale</small>}</div></> : reservoir && model ? workflow === "pythermogis" && thermoModel ? <Geology3DViewer reservoirs={model.reservoirs} dataReservoirs={thermoModel.reservoirs} activeId={reservoirId} selected={selectedThermo} geometrySelected={selected} property={activeThermoField} propertyLabel={thermoProperties[thermoProperty].label} propertyUnit={thermoProperties[thermoProperty].unit} digits={thermoProperties[thermoProperty].digits} palette={thermoProperties[thermoProperty].palette} fixedRange={thermoRange} dataModeLabel={`PyThermoGIS P${percentile}`} onSelect={(point) => selectThermoPoint(point as ThermoPoint)} /> : <Geology3DViewer reservoirs={model.reservoirs} activeId={reservoirId} selected={selected} geometrySelected={selected} property={property} propertyLabel={properties[property].label} propertyUnit={properties[property].unit} digits={properties[property].digits} palette={properties[property].palette} onSelect={(point) => selectPoint(point as Point)} /> : <div className="loading-state">Preparing 3D architecture…</div>}
      </div>
    </section>

    <aside className="detail-panel">
      <div className="detail-header"><div className="detail-icon"><MapPin /></div><div><p>Selected location</p><h2>Reservoir stack</h2></div></div>
      <div className="stack-list">{showingThermo ? thermoStack.map(({ reservoir: item, point }) => <button key={item.id} className={`stack-row ${item.id === reservoirId ? "active" : ""}`} onClick={() => chooseReservoir(item.id)}><span className="depth-line" /><div className="stack-name"><strong>{item.name}</strong><span>PyThermoGIS · P{percentile}</span></div><div className="stack-value"><strong>{thermoFmt(point[activeThermoField], thermoProperty)}</strong><span>{thermoProperties[thermoProperty].unit}</span></div></button>) : stack.map(({ reservoir: item, point }) => <button key={item.id} className={`stack-row ${item.id === reservoirId ? "active" : ""}`} onClick={() => chooseReservoir(item.id)}><span className="depth-line" /><div className="stack-name"><strong>{item.name}</strong><span>{fmt(point.top_depth, "top_depth")} m bMSL</span></div><div className="stack-value"><strong>{fmt(point[property], property)}</strong><span>{properties[property].unit}</span></div></button>)}</div>
      {showingThermo && selectedThermo ? <div className="cell-summary"><p className="eyebrow">PyThermoGIS P{percentile} cell</p><div className="metric-grid"><Metric label="Power" value={`${thermoFmt(selectedThermo[thermoField("power", percentile)], "power")} MW`} /><Metric label="Flow" value={`${thermoFmt(selectedThermo[thermoField("flow_rate", percentile)], "flow_rate")} m³/h`} /><Metric label="Prod. temp" value={`${thermoFmt(selectedThermo[thermoField("prd_temp", percentile)], "prd_temp")} °C`} /><Metric label="Pressure" value={`${thermoFmt(selectedThermo[thermoField("pres", percentile)], "pres")} bar`} /><Metric label="Well spacing" value={`${thermoFmt(selectedThermo[thermoField("welld", percentile)], "welld")} m`} /><Metric label="CAPEX" value={`${thermoFmt(selectedThermo[thermoField("capex", percentile)], "capex")} M€`} /></div></div> : selected && <div className="cell-summary"><p className="eyebrow">Current cell</p><div className="metric-grid"><Metric label="Top" value={`${fmt(selected.top_depth, "top_depth")} m`} /><Metric label="Gross" value={`${fmt(selected.thickness_mean, "thickness_mean")} m`} /><Metric label="Net-to-gross" value={fmt(selected.ntg, "ntg")} /><Metric label="Porosity" value={fmt(selected.porosity, "porosity")} /><Metric label="Permeability" value={`${fmt(selected.permeability, "permeability")} mD`} /><Metric label="Temperature" value={`${fmt(selected.temperature, "temperature")} °C`} /><Metric label="Well support" value={`${Math.round(selected.well_support * 100)}%`} /></div></div>}
      <footer><Activity /> {model?.model_version ?? "Loading provenance"}</footer>
    </aside>
    </>}
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function CalcField({ label, unit, value, setValue, step = 1 }: { label: string; unit: string; value: number; setValue: (value: number) => void; step?: number }) { return <label><span>{label}<small>{unit}</small></span><input type="number" step={step} value={value} onChange={(event) => setValue(Number(event.target.value))} /></label>; }
function Result({ label, value, unit, featured = false }: { label: string; value: string; unit: string; featured?: boolean }) { return <div className={featured ? "featured" : ""}><span>{label}</span><strong>{value} <small>{unit}</small></strong></div>; }
