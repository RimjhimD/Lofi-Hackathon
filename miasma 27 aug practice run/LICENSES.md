# LICENSES.md — template

A required, scored submission component (4 marks — Rubric §6). Copy into each problem
repo and extend with anything added on the night. Rulebook §7: no GPL/LGPL/AGPL/MPL/
SSPL, nothing non-commercial. MIT / Apache-2.0 / BSD / ISC are fine.

## Runtime dependencies
| Package | Licence |
|---|---|
| react | MIT |
| react-dom | MIT |
| @supabase/supabase-js | MIT |

## Build/dev dependencies
| Package | Licence |
|---|---|
| vite | MIT |
| @vitejs/plugin-react | MIT |
| tailwindcss / @tailwindcss/vite | MIT |
| wrangler (deploy CLI only, not shipped) | MIT OR Apache-2.0 |

## Templates and pre-existing code
| Asset | Source | Licence |
|---|---|---|
| Starter kit (Vite + React + Tailwind scaffold, recipes) | our own pre-existing work | MIT (our code) |

## Added on the night
<!-- Every library, icon set, font, stock asset, or snippet you bring in goes here,
     with its licence. Fonts: Google Fonts are OFL — fine. Icons: check each set. -->
| Asset | Source | Licence |
|---|---|---|

## Map data

| Asset | Source | Licence |
|---|---|---|
| `public/raozan-upazila.geojson` | geoBoundaries gbOpen ADM3 (Bangladesh Bureau of Statistics / OCHA ROAP), simplified to 321 points | CC BY 3.0 IGO — attribution only, commercial use permitted |
| Map tiles | OpenStreetMap contributors, via tile.openstreetmap.org | ODbL — attribution shown in the map's attribution control |
| Leaflet 1.9.4 | loaded at runtime from unpkg CDN (not an npm dependency) | BSD-2-Clause |
