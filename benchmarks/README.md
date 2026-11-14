# Gassum doublet comparison

Run `node benchmarks/gassum-doublet.mjs` from the repository root. The JavaScript model receives only case inputs. The comparison reads the saved open-DARTS outputs after prediction. Flow is time-weighted production, pressure error is time-weighted RMSE of the injector–producer BHP difference, and breakthrough is the first year-end observation at least 1 °C below the initial reservoir temperature.

| Case | Mean production, DARTS / screening (m³/h) | BHP difference RMSE (bar) | First year of breakthrough, DARTS / screening | NPV, DARTS / screening (M€) |
|---|---:|---:|---|---:|
| Steady, 1,200 m | 94.36 / 94.36 | 0.58 | Neither by year 30 | 1.718 / 1.785 |
| Seasonal, 1,200 m | 86.43 / 86.28 | 0.12 | Neither by year 30 | 0.420 / 0.459 |
| Higher throughput, 1,200 m | 116.12 / 115.89 | <0.01 | Neither by year 30 | 5.362 / 5.418 |
| Steady, 400 m holdout | 94.36 / 94.36 | 0.77 | 9 / 8 | −0.896 / −1.601 |

The three original runs informed development. The revised hydraulics apply independent well-rate and pressure limits, include interference between wells and approximate viscosity changes in the cooled zone. Net production can draw from the lateral boundary. The former balanced-rate approximation capped both steady and higher production at 79.78 m³/h. The well-temperature estimate includes a first-order freshwater pressure correction.

The holdout changes only spacing from the steady reference. Both simulations place the wells eight 50 m cells apart. To reproduce its open-DARTS 2.1.0 reference, use the solver environment documented in the root README and run `python benchmarks/generate-short-spacing.py`. The stored case includes 30 annual temperature maps and 660 well observations. The browser candidate was fixed before evaluating this case. The year-30 temperatures are 42.50 °C (DARTS) and 41.03 °C (screening). The corresponding 1 °C cooled footprints overlap by 91% (intersection over union).

All NPVs apply common illustrative prices, demand cap, pumping efficiency, discounting and CAPEX, including the shorter-spacing comparison. The model approximates homogeneous single-layer flow, neglects pressure transients, and uses an analytical velocity field for thermal transport. These checks cover one geological setting. The 400 m case has appreciable late-temperature and NPV error, and a near-zero BHP difference error when both limits bind reflects the prescribed pressure window. Grid convergence and field validation remain open.
