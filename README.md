# Geothermal Explorer

DECODE turns regional geological-model inputs into reservoir maps, an interactive 2D/3D browser, probabilistic geothermal screening outputs, and an adjustable doublet assessment.

The repository contains the processing code, FastAPI service, website, configuration, tests, and lightweight demonstration assets. Original geological deliveries, well files, generated scientific rasters, and the PyThermoGIS distribution itself are intentionally not included; `uv` installs PyThermoGIS directly from TNO's official package index.

Hosted demonstration: <https://decode-geothermal-explorer.floriansmit88.chatgpt.site/>

## Main capabilities

- Reservoir maps for depth, thickness, net-to-gross, porosity, permeability, temperature, transmissivity, and confidence
- Interactive OpenStreetMap view with address search and selectable model cells
- 3D geological architecture, formation visibility controls, property colouring, and well trajectories
- Fixed colour scales for meaningful P10/P50/P90 comparisons
- Heat-demand, district-heating, and industrial-demand context layers
- Browser-based model-building workflow for horizons, wells, tops, property grids, and uncertainty assignments
- Local FastAPI endpoint for the real PyThermoGIS 3 Java-backed calculation engine
- DoubletCalc1D workspace initialised from PyThermoGIS results

## Demo screenshots

The hosted demo combines the regional reservoir grids with an OpenStreetMap basemap, selectable model cells, study wells, and an address search.

![Interactive 2D geology map showing the Gassum temperature grid and study wells](docs/images/demo-geology-map.png)

The 3D viewer displays the geological architecture, coloured reservoir-property surfaces, formation visibility controls, and well trajectories.

![Interactive 3D geological architecture and temperature surface](docs/images/demo-geology-3d.png)

PyThermoGIS outputs can be inspected over the same 2D or 3D geometry, including fixed P10–P90 colour ranges and cell-level doublet results.

![PyThermoGIS P50 geothermal-power results in the 3D viewer](docs/images/demo-pythermogis-3d.png)

## Included demo data

The browser-ready demonstration dataset is committed under `apps/web/public/data` and totals approximately 10.2 MiB:

- `model-preview.json` — downsampled 2D geological and reservoir-property grids
- `architecture-3d.json` — 3D horizons, architecture, and demonstration well trajectories
- `pythermogis-preview.json` — precomputed stochastic PyThermoGIS outputs
- `cultural-data.json` — demonstration heat-market and cultural overlays

These files are sufficient for the hosted Demo experience. The original geological deliveries and nationwide well archive are not required by the browser and remain excluded from Git.

## Repository layout

```text
apps/api/               FastAPI and PyThermoGIS HTTP service
apps/web/               Interactive website and bundled demo assets
config/                 Reservoir definitions and provisional priors
docs/                   Architecture, data formats, and model contract
src/decode3d/           Geological ingestion and processing library
tests/                  Python processing tests
setup-local.cmd         One-time Windows setup launcher
run-local.cmd           Windows launcher for website + API
```

## Run locally on Windows

### Requirements

- Windows 10 or 11
- Python 3.11–3.13 available as `python`
- Node.js 22 or newer with `npm`
- Internet access during setup
- At least 500 MiB of free space for PyThermoGIS and its managed Java 17 runtime, in addition to the normal Python and Node dependencies

PyThermoGIS is published on TNO's GitLab package index rather than public PyPI. Its package is about 150 MiB and it automatically provisions a Java 17 runtime of about 350 MiB. Review and comply with TNO's applicable software terms. The setup uses `uv` for the complete Python environment and bootstraps `uv` automatically if it is not already installed.

### Installation

```powershell
git clone https://github.com/floriansmit/geothermal-explorer.git
cd geothermal-explorer
.\setup-local.cmd
```

The setup uses the committed `uv.lock` to create and synchronise `.venv`, installs DECODE and PyThermoGIS 3 from their configured indexes, prepares PyThermoGIS's managed Java 17 runtime, and installs the website dependencies. The first setup can take several minutes because the Python package and JVM together require roughly 500 MiB. The `.cmd` launcher applies `ExecutionPolicy Bypass` only to its child process and does not modify the machine-wide PowerShell policy.

### Start the application

```powershell
.\run-local.cmd
```

Then open:

- Website: <http://localhost:5173>
- API health: <http://127.0.0.1:8000/v1/pythermogis/health>
- FastAPI schema: <http://127.0.0.1:8000/docs>

Keep the launcher window open while using the application. Press `Ctrl+C` to stop both services.

## Manual installation

The following is useful on macOS/Linux or when managing the processes independently:

```bash
uv sync --extra api --extra thermogis --extra test
uv run python -c "from pythermogis.jvm import start_jvm; start_jvm()"
cd apps/web
npm install
```

Start the API from the repository root:

```bash
uv run uvicorn apps.api.main:app --host 127.0.0.1 --port 8000
```

Start the website in another terminal:

```bash
cd apps/web
NEXT_PUBLIC_PYTHERMOGIS_API=http://127.0.0.1:8000 npm run dev
```

## Data and first-pass processing

The source deliveries expected by the processing workflow are deliberately ignored by Git. Place authorised local data in the documented folders, then run:

```powershell
uv run python -m decode3d.processing.first_pass
uv run python -m decode3d.calculations.pythermogis_adapter --dry-run
```

Generated NetCDF and GeoTIFF products are written to `data/derived`. Downsampled, browser-safe demonstration products are written to `apps/web/public/data`.

See [Data inputs and provenance](docs/data-inputs.md) and the [data contract](docs/data-contract.md) before adding a new delivery.

## Validation

```powershell
uv run pytest
cd apps\web
npm run build
```

GitHub Actions runs the public Python tests and frontend production build. Tests requiring the licensed PyThermoGIS engine remain local.

## Deployment boundary

The hosted demonstration uses precomputed outputs and browser-side interactions. The Build Model workflow can prepare inputs online, but executing the real PyThermoGIS engine requires the Python/Java API. A future production deployment can connect the public frontend to an authorised private container endpoint over HTTPS.

See [Architecture](docs/architecture.md) for details.

## Licensing and data rights

No licence is granted for third-party geological deliveries, well data, cultural datasets, or PyThermoGIS by this repository. Confirm the applicable licences before publishing derived data or deploying the calculation engine. See [NOTICE.md](NOTICE.md).
