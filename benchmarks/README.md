# Gassum doublet comparison

Run `node benchmarks/gassum-doublet.mjs` from the repository root. The JavaScript model receives only case inputs. The comparison reads the saved open-DARTS outputs after prediction. Flow is time-weighted production, pressure error is time-weighted RMSE of the injector–producer BHP difference, and breakthrough is the first year-end observation at least 1 °C below the initial reservoir temperature.

The three 1,200 m cases and the 400 m breakthrough case informed development. An independent 600 m open-DARTS run was evaluated after the transport change. All five use the same Gassum geology, 50 m cells and 30-year horizon.

| Case | Year-30 temperature, DARTS / screening (°C) | Time to 1 °C cooling, DARTS / screening (years) | NPV, DARTS / screening (M€) | Final plume overlap |
|---|---:|---:|---:|---:|
| steady | 50.99 / 50.99 | Beyond 30 | 1.718 / 1.728 | 98.8% |
| seasonal | 50.90 / 50.90 | Beyond 30 | 0.420 / 0.417 | 98.6% |
| higher | 51.07 / 51.07 | Beyond 30 | 5.362 / 5.377 | 96.0% |
| 400m | 42.50 / 42.44 | 8.002 / 7.891 | -0.896 / -0.992 | 98.5% |
| 600m | 47.49 / 47.38 | 20.295 / 20.045 | 1.257 / 1.242 | 98.7% |

Time to cooling is linearly interpolated from native well output histories (half-yearly for screening). At 400 m the first annual snapshot below threshold falls in year 9 for DARTS and year 8 for screening. The interpolated difference is 0.11 years. Max year-end well-temperature errors are 0.16 °C at 400 m and 0.11 °C at 600 m. Overlap is intersection over union for cells cooled by at least 1 °C at year 30.

The earlier analytical transport velocity field assumed spatially uniform viscosity. The revision solves a finite-volume pressure equation each half-year for the independently constrained well rates, using local temperature-dependent mobility and fixed-pressure boundaries. Face fluxes advect heat with first-order upwinding. A first-order liquid-water enthalpy correction accounts for pressure changes along flow paths and between well cells and bottom-hole conditions. Well rates are still estimated using analytical resistances. This is a single-layer, quasi-steady pressure approximation.

At 400 m the prior screening estimate was 41.03 °C at year 30 and −1.601 M€ NPV. Economic comparisons use common illustrative prices, demand, pumping efficiency, discounting and CAPEX. To regenerate each short-spacing open-DARTS 2.1.0 fixture, run `python benchmarks/generate-short-spacing.py --spacing 400` or `--spacing 600` in the documented solver environment. These comparisons cover one homogeneous reservoir; grid convergence and field validation remain open.
