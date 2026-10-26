"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Eye, EyeOff, Layers3, RotateCcw } from "lucide-react";

type ModelPoint = { lon: number; lat: number; top_depth: number; thickness_mean: number } & Record<string, number>;
type Reservoir = { id: string; name: string; points: ModelPoint[] };
type DataPoint = { lon: number; lat: number; valid_mask?: number } & Record<string, number>;
type DataReservoir = { id: string; name: string; points: DataPoint[] };
type WellTrajectory = { name: string; source: string; trajectory: Array<{ md_m: number; lon: number; lat: number; depth_m_bmsl: number }> };
type Architecture = {
  model_version: string;
  grid: { rows: number; cols: number; longitude: number[]; latitude: number[] };
  horizons: Array<{ id: string; name: string; depths_m_bmsl: number[] }>;
  intervals: Array<{ id: string; name: string; top_horizon: string; base_horizon: string; kind: "reservoir" | "non_reservoir" }>;
  wells: WellTrajectory[];
};
type Face = { points: Array<{ x: number; y: number }>; depth: number; fill: string; stroke: string; lineWidth: number };
type WellSegment = { start: { x: number; y: number }; end: { x: number; y: number }; depth: number };
type RenderItem = ({ kind: "face" } & Face) | ({ kind: "well" } & WellSegment);

const RESERVOIR_COLOURS: Record<string, string> = {
  chalk_shallow: "#9bdcf2",
  frederikshavn: "#e8c84f",
  haldager_sand: "#f0cf50",
  gassum: "#ffd85c",
  skagerrak: "#e7bf43",
  bunter_sandstone: "#dcb43e",
};

const DEFAULT_VERTICAL_EXAGGERATION = 10;
const KM_PER_DEGREE_LATITUDE = 111.32;

export function Geology3DViewer({ reservoirs, dataReservoirs, activeId, selected, geometrySelected, property, propertyLabel, propertyUnit, digits, palette, fixedRange, dataModeLabel = "Geology", onSelect }:
  { reservoirs: Reservoir[]; dataReservoirs?: DataReservoir[]; activeId: string; selected: DataPoint | null; geometrySelected?: ModelPoint | null; property: string; propertyLabel: string; propertyUnit: string; digits: number; palette: string[]; fixedRange?: number[]; dataModeLabel?: string; onSelect: (point: DataPoint) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hitPoints = useRef<Array<{ x: number; y: number; index: number }>>([]);
  const [architecture, setArchitecture] = useState<Architecture | null>(null);
  const [size, setSize] = useState({ width: 900, height: 650 });
  const [yaw, setYaw] = useState(-.72);
  const [pitch, setPitch] = useState(-.5);
  const [zoom, setZoom] = useState(1);
  const [verticalExaggeration, setVerticalExaggeration] = useState(DEFAULT_VERTICAL_EXAGGERATION);
  const [showArchitecture, setShowArchitecture] = useState(true);
  const [showWells, setShowWells] = useState(true);
  const [showData, setShowData] = useState(true);
  const [visible, setVisible] = useState<Set<string>>(() => new Set([activeId]));

  useEffect(() => { fetch("/data/architecture-3d.json").then((response) => response.json() as Promise<Architecture>).then(setArchitecture); }, []);
  useEffect(() => { setVisible((current) => new Set([...current, activeId])); }, [activeId]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);

  const activeReservoir = reservoirs.find((item) => item.id === activeId);
  const activeDataReservoir = (dataReservoirs ?? reservoirs).find((item) => item.id === activeId);
  const calculatedRange = useMemo(() => {
    const values = activeDataReservoir?.points.filter((point) => point.valid_mask !== 0 && Number.isFinite(point[property])).map((point) => point[property]).sort((a, b) => a - b) ?? [];
    return [values[Math.floor(values.length * .03)] ?? 0, values[Math.floor(values.length * .97)] ?? 1];
  }, [activeDataReservoir, property]);
  const dataRange = fixedRange ?? calculatedRange;
  const horizonMap = useMemo(() => new Map(architecture?.horizons.map((item) => [item.id, item]) ?? []), [architecture]);
  const depthRange = useMemo(() => {
    if (!architecture) return { min: 0, max: 4000 };
    let min = Infinity, max = -Infinity;
    for (const horizon of architecture.horizons) for (const depth of horizon.depths_m_bmsl) { if (Number.isFinite(depth)) { min = Math.min(min, depth); max = Math.max(max, depth); } }
    return { min, max };
  }, [architecture]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !architecture || !size.width || !size.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d"); if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const { rows, cols, longitude, latitude } = architecture.grid;
    const minLon = Math.min(...longitude), maxLon = Math.max(...longitude), minLat = Math.min(...latitude), maxLat = Math.max(...latitude);
    const centreLon = (minLon + maxLon) / 2, centreLat = (minLat + maxLat) / 2;
    const kmPerDegreeLongitude = KM_PER_DEGREE_LATITUDE * Math.cos(centreLat * Math.PI / 180);
    const widthKm = (maxLon - minLon) * kmPerDegreeLongitude;
    const heightKm = (maxLat - minLat) * KM_PER_DEGREE_LATITUDE;
    const horizontalHalfSpanKm = Math.max(widthKm, heightKm, 1) / 2;
    const centreDepthM = (depthRange.min + depthRange.max) / 2;
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw), cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
    const sceneScale = Math.min(size.width, size.height) * .35 * zoom;
    const toScreenCoordinate = (lon: number, lat: number, depth: number) => {
      // All three axes use the same kilometre-based world scale. This makes 1×
      // a true, non-exaggerated geological view rather than a normalization of
      // the full depth range to almost the full horizontal map width.
      const x = (lon - centreLon) * kmPerDegreeLongitude / horizontalHalfSpanKm;
      const z = (lat - centreLat) * KM_PER_DEGREE_LATITUDE / horizontalHalfSpanKm;
      const y = -(depth - centreDepthM) / 1000 / horizontalHalfSpanKm * verticalExaggeration;
      const xr = x * cosYaw - z * sinYaw, zr = x * sinYaw + z * cosYaw;
      const yr = y * cosPitch - zr * sinPitch, cameraZ = y * sinPitch + zr * cosPitch;
      const perspective = 4.2 / (4.2 + cameraZ * .55);
      return { x: size.width / 2 + xr * sceneScale * perspective, y: size.height * .47 - yr * sceneScale * perspective, z: cameraZ };
    };
    const toScreen = (index: number, depth: number) => toScreenCoordinate(longitude[index], latitude[index], depth);

    const faces: Face[] = [];
    const addFace = (indices: number[], depths: number[], fill: string, stroke: string, lineWidth: number) => {
      const projected = indices.map((index, offset) => toScreen(index, depths[offset]));
      faces.push({ points: projected, depth: projected.reduce((sum, point) => sum + point.z, 0) / projected.length, fill, stroke, lineWidth });
    };
    const stride = 2;
    for (const interval of architecture.intervals) {
      const isReservoir = interval.kind === "reservoir";
      if (isReservoir && !visible.has(interval.id)) continue;
      if (!isReservoir && !showArchitecture) continue;
      const top = horizonMap.get(interval.top_horizon)?.depths_m_bmsl, base = horizonMap.get(interval.base_horizon)?.depths_m_bmsl;
      if (!top || !base) continue;
      const active = interval.id === activeId;
      const colour = isReservoir ? RESERVOIR_COLOURS[interval.id] ?? "#efd05a" : "#87909a";
      const alpha = isReservoir ? (active ? .76 : .48) : .16;
      const fill = hexToRgba(colour, alpha), stroke = active ? "rgba(255,247,196,.78)" : isReservoir ? "rgba(52,48,31,.45)" : "rgba(205,211,216,.18)";
      const dataPoints = active && showData ? activeDataReservoir?.points : null;
      for (let row = 0; row < rows - stride; row += stride) for (let col = 0; col < cols - stride; col += stride) {
        const indices = [row * cols + col, row * cols + col + stride, (row + stride) * cols + col + stride, (row + stride) * cols + col];
        let surfaceFill = fill;
        if (dataPoints) {
          const values = indices.map((index) => dataPoints[index]).filter((point) => point?.valid_mask !== 0 && Number.isFinite(point?.[property])).map((point) => point[property]);
          if (values.length) {
            const value = values.reduce((sum, item) => sum + item, 0) / values.length;
            surfaceFill = colourRamp(palette, (value - dataRange[0]) / Math.max(dataRange[1] - dataRange[0], .0001), .9);
          } else surfaceFill = "rgba(58,64,72,.34)";
        }
        addFace(indices, indices.map((index) => top[index]), surfaceFill, stroke, active ? 1.05 : .45);
      }
      const boundaries = [
        Array.from({ length: Math.ceil((cols - 1) / stride) }, (_, n) => [n * stride, Math.min((n + 1) * stride, cols - 1)]),
        Array.from({ length: Math.ceil((cols - 1) / stride) }, (_, n) => [(rows - 1) * cols + n * stride, (rows - 1) * cols + Math.min((n + 1) * stride, cols - 1)]),
        Array.from({ length: Math.ceil((rows - 1) / stride) }, (_, n) => [n * stride * cols, Math.min((n + 1) * stride, rows - 1) * cols]),
        Array.from({ length: Math.ceil((rows - 1) / stride) }, (_, n) => [n * stride * cols + cols - 1, Math.min((n + 1) * stride, rows - 1) * cols + cols - 1]),
      ];
      for (const boundary of boundaries) for (const [a, b] of boundary) addFace([a, b, b, a], [top[a], top[b], base[b], base[a]], hexToRgba(colour, alpha * .82), stroke, .55);
    }
    const wellSegments: WellSegment[] = [];
    const projectedWells = showWells ? (architecture.wells ?? []).map((well) => {
      const dense: Array<{ x: number; y: number; z: number }> = [];
      for (let index = 0; index < well.trajectory.length - 1; index++) {
        const start = well.trajectory[index], end = well.trajectory[index + 1];
        const steps = Math.max(1, Math.ceil(Math.abs(end.depth_m_bmsl - start.depth_m_bmsl) / 60));
        for (let step = 0; step < steps; step++) {
          const fraction = step / steps;
          dense.push(toScreenCoordinate(
            start.lon + (end.lon - start.lon) * fraction,
            start.lat + (end.lat - start.lat) * fraction,
            start.depth_m_bmsl + (end.depth_m_bmsl - start.depth_m_bmsl) * fraction,
          ));
        }
      }
      const last = well.trajectory.at(-1);
      if (last) dense.push(toScreenCoordinate(last.lon, last.lat, last.depth_m_bmsl));
      for (let index = 0; index < dense.length - 1; index++) {
        const start = dense[index], end = dense[index + 1];
        wellSegments.push({ start, end, depth: (start.z + end.z) / 2 });
      }
      return { well, projected: dense };
    }) : [];

    const renderItems: RenderItem[] = [
      ...faces.map((face): RenderItem => ({ kind: "face", ...face })),
      ...wellSegments.map((segment): RenderItem => ({ kind: "well", ...segment })),
    ];
    renderItems.sort((a, b) => b.depth - a.depth);
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const item of renderItems) {
      if (item.kind === "face") {
        context.beginPath(); item.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath();
        context.fillStyle = item.fill; context.fill(); context.strokeStyle = item.stroke; context.lineWidth = item.lineWidth; context.stroke();
      } else {
        context.beginPath(); context.moveTo(item.start.x, item.start.y); context.lineTo(item.end.x, item.end.y);
        context.strokeStyle = "rgba(18,22,29,.94)"; context.lineWidth = 5; context.stroke();
        context.beginPath(); context.moveTo(item.start.x, item.start.y); context.lineTo(item.end.x, item.end.y);
        context.strokeStyle = "#f5eee0"; context.lineWidth = 2.2; context.stroke();
      }
    }

    if (showWells) {
      for (const { well, projected } of projectedWells) {
        if (projected.length < 2) continue;
        const collar = projected[0], td = projected[projected.length - 1];
        context.beginPath(); context.arc(collar.x, collar.y, 4, 0, Math.PI * 2); context.fillStyle = "#d76e42"; context.fill(); context.strokeStyle = "#fff4df"; context.lineWidth = 1.2; context.stroke();
        context.beginPath(); context.rect(td.x - 3, td.y - 3, 6, 6); context.fillStyle = "#d76e42"; context.fill(); context.strokeStyle = "#fff4df"; context.lineWidth = 1; context.stroke();
        context.font = "600 11px Inter, system-ui, sans-serif"; context.textBaseline = "middle";
        const labelWidth = context.measureText(well.name).width;
        context.fillStyle = "rgba(17,21,28,.82)"; context.fillRect(collar.x + 7, collar.y - 10, labelWidth + 10, 20);
        context.fillStyle = "#fff8e9"; context.fillText(well.name, collar.x + 12, collar.y);
      }
    }

    const activeInterval = architecture.intervals.find((item) => item.id === activeId);
    const activeTop = activeInterval && visible.has(activeId) ? horizonMap.get(activeInterval.top_horizon)?.depths_m_bmsl : null;
    hitPoints.current = activeTop ? activeTop.map((depth, index) => ({ ...toScreen(index, depth), index })) : [];
    if (selected && activeDataReservoir) {
      const selectedIndex = activeDataReservoir.points.findIndex((point) => point.lon === selected.lon && point.lat === selected.lat);
      const hit = hitPoints.current[selectedIndex];
      if (hit) { context.beginPath(); context.arc(hit.x, hit.y, 7, 0, Math.PI * 2); context.fillStyle = "#11151c"; context.fill(); context.strokeStyle = "#fff4b6"; context.lineWidth = 2.5; context.stroke(); }
    }
  }, [architecture, size, yaw, pitch, zoom, verticalExaggeration, showArchitecture, showWells, showData, visible, activeId, selected, activeReservoir, activeDataReservoir, depthRange, horizonMap, property, palette, dataRange]);

  const resetView = () => { setYaw(-.72); setPitch(-.5); setZoom(1); setVerticalExaggeration(DEFAULT_VERTICAL_EXAGGERATION); };
  const toggleReservoir = (id: string) => setVisible((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, moved: false }; };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
    setYaw((value) => value + dx * .008); setPitch((value) => Math.max(-Math.PI / 2, Math.min(.35, value - dy * .006)));
    drag.current.x = event.clientX; drag.current.y = event.clientY;
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current && !drag.current.moved && activeDataReservoir) {
      const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      let nearest: { x: number; y: number; index: number } | null = null, distance = Infinity;
      for (const point of hitPoints.current) { const value = Math.hypot(point.x - x, point.y - y); if (value < distance) { nearest = point; distance = value; } }
      if (nearest && distance < 22 && activeDataReservoir.points[nearest.index]) onSelect(activeDataReservoir.points[nearest.index]);
    }
    drag.current = null;
  };
  const selectedValue = selected?.[property];

  return <div ref={containerRef} className="viewer-3d">
    <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.45, Math.min(2.8, value * (event.deltaY < 0 ? 1.1 : .9)))); }} aria-label="Interactive 3D geological architecture viewer" />
    {!architecture && <div className="viewer-loading"><Box /> Loading 3D horizons…</div>}
    <div className="viewer-instructions">Drag to rotate · Scroll to zoom · Click the active surface to inspect</div>
    <div className="viewer-toolbar">
      <button onClick={() => setZoom((value) => Math.min(2.8, value * 1.15))}>+</button><button onClick={() => setZoom((value) => Math.max(.45, value / 1.15))}>−</button><button className="top-view" onClick={() => { setYaw(0); setPitch(-Math.PI / 2); }} title="Top view">TOP</button><button onClick={resetView} title="Reset 3D view"><RotateCcw /></button>
    </div>
    <div className="viewer-layers">
      <div><span><Layers3 /> Layers</span><small>Multiple selection</small></div>
      <button className={showArchitecture ? "enabled" : ""} onClick={() => setShowArchitecture((value) => !value)}>{showArchitecture ? <Eye /> : <EyeOff />}<i className="layer-swatch architecture" /><span>Non-reservoir architecture<small>Grey intervals</small></span></button>
      <button className={showWells ? "enabled" : ""} onClick={() => setShowWells((value) => !value)}>{showWells ? <Eye /> : <EyeOff />}<i className="layer-swatch wells" /><span>Well trajectories<small>{architecture?.wells?.length ?? 0} deviation surveys</small></span></button>
      <button className={showData ? "enabled data-layer" : "data-layer"} onClick={() => setShowData((value) => !value)}>{showData ? <Eye /> : <EyeOff />}<i className="layer-swatch data" style={{ background: `linear-gradient(135deg,${palette.join(",")})` }} /><span>Active data surface<small>{propertyLabel} · {dataModeLabel}</small></span></button>
      {reservoirs.map((reservoir) => { const enabled = visible.has(reservoir.id), active = reservoir.id === activeId; return <button key={reservoir.id} className={`${enabled ? "enabled" : ""} ${active ? "active" : ""}`} onClick={() => toggleReservoir(reservoir.id)}>{enabled ? <Eye /> : <EyeOff />}<i className={`layer-swatch ${reservoir.id === "chalk_shallow" ? "chalk" : "reservoir"}`} /><span>{reservoir.name}<small>{active ? "Active reservoir" : "Reservoir"}</small></span></button>; })}
      <label title="At 1×, horizontal distance and depth use the same physical scale.">Vertical exaggeration <strong>{verticalExaggeration.toFixed(0)}×</strong><input type="range" min="1" max="30" step="1" value={verticalExaggeration} onChange={(event) => setVerticalExaggeration(Number(event.target.value))} /><small>1× = true scale</small></label>
    </div>
    <div className="viewer-data">
      <p>{dataModeLabel} data surface</p><strong><i className="layer-swatch data" style={{ background: `linear-gradient(135deg,${palette.join(",")})` }} />{activeReservoir?.name}</strong>
      <div><span>{propertyLabel}</span><b>{selectedValue == null ? "—" : selectedValue.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })} <small>{propertyUnit}</small></b></div>
      <div><span>Top depth</span><b>{geometrySelected?.top_depth.toFixed(0) ?? (selected?.top_depth?.toFixed(0) || "—")} <small>m bMSL</small></b></div>
      <div><span>Gross thickness</span><b>{geometrySelected?.thickness_mean.toFixed(0) ?? (selected?.thickness_mean?.toFixed(0) || "—")} <small>m</small></b></div>
      <div className="viewer-data-ramp"><i style={{ background: `linear-gradient(90deg,${palette.join(",")})` }} /><span>{dataRange[0].toLocaleString("en-GB", { maximumFractionDigits: digits })}</span><span>{dataRange[1].toLocaleString("en-GB", { maximumFractionDigits: digits })} {propertyUnit}</span>{fixedRange && <small>Fixed P10–P90 scale</small>}</div>
    </div>
    <div className="viewer-scale"><span>MSL</span><i /><span>{Math.round(depthRange.max).toLocaleString("en-GB")} m bMSL</span></div>
  </div>;
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", ""), bigint = parseInt(value, 16);
  return `rgba(${(bigint >> 16) & 255},${(bigint >> 8) & 255},${bigint & 255},${alpha})`;
}

function colourRamp(palette: string[], value: number, alpha: number) {
  const t = Math.max(0, Math.min(.999, value)), index = Math.floor(t * (palette.length - 1)), local = t * (palette.length - 1) - index;
  const a = palette[index].match(/\w\w/g)!.map((part) => parseInt(part, 16));
  const b = palette[index + 1].match(/\w\w/g)!.map((part) => parseInt(part, 16));
  const rgb = a.map((channel, offset) => Math.round(channel + (b[offset] - channel) * local));
  return `rgba(${rgb.join(",")},${alpha})`;
}
