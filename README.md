# Neighborhood Spending Gaps: build pipeline

The scripts that build the data and the page for the public site at
https://mjkelley00-mjk.github.io/neighborhood-spending-gaps/ (repository `mjkelley00-mjk/neighborhood-spending-gaps`).

This repository is private. The raw inputs are public but large (about 5 GB, 3.9 GB of it the Who's On First
database), so they are not committed. [INPUTS.md](INPUTS.md) lists every one: where it goes, where it comes from,
which vintage the current build uses, and when the next one is due.

## Layout

```
INPUTS.md                    every input file, its source and vintage
build.sh                     runs the whole build in order
national/
  extract_napcs.py           products-by-industry extract from the 2022 Economic Census
  fetch_ce_detail.py         detailed spending items by income (club memberships, sports fees, lessons, child care), BLS API
  ce_restaurant_split.py     full-service share of restaurant spending by income (CE Diary)
  extract_nonemployer.py     self-employed businesses by county (Nonemployer Statistics)
  extract_overlays.py        Opportunity Zone, NMTC, CDFI, HUD and food-access flags per tract
  local_sources.py           the state and local incentive layers read (enterprise zones, TIF districts, BIDs, sites)
  extract_local.py           fetches those layers and measures each tract's share inside each district
  extract_stores.py          SNAP retailers and Overture places counted per tract
  extract_health.py          hospitals (Medicare list, geocoded) and community health centers (HRSA) per tract
  extract_visitor.py         seasonal homes and lodging places per tract, for the visitor-economy flag
  extract_urban.py           each tract's urban share of residents (2020 urban areas)
  rural_factors.py           rural spending beyond what income predicts, by category (applied by build_national)
  build_national.py          demand and two supply estimates for every US tract
  build_neighborhoods.py     named areas (Who's On First, Chicago) matched to tracts
  build_peers.py             typical retention for similar places (kind, setting, population)
  build_site_data.py         packages tract figures, shapes and named areas for the page
  ss_check.py                prints South Shore's figures, the check against the hand-built baseline
  extract_il_salestax.py     Illinois taxable sales by kind of business, by municipality
  il_validate.py             compares the sales estimates with Illinois taxable sales
  extract_state_salestax.py  taxable sales by kind of business in 20 more states
  state_validate.py          compares the sales estimates with them; state_validate_coverage.py lists every state
  rates/                     one script per state (or group of states) for sales-tax rates, and taxability.py
  nes_analysis.py            how much self-employed businesses add, by store type (analysis)
  bea_analysis.py            survey spending against BEA's state consumer spending (analysis)
  site/index.html            the page template
  rates/run_all.py           rebuilds every state's sales-tax table and the taxability table
  out/ce_fsr_share.json      reference outputs of the current build, kept to compare a rebuild against
  out/build_meta.json
  out/rates/, out/*.json     the derived tables the site is packaged from (rates, taxability, overlays, stores,
                             nonemployer receipts, visitor figures, urban shares, rural factors, similar places,
                             states' taxable sales and the checks), committed so
                             `./build.sh site` works from a fresh clone given national/out/tracts.csv, out/areas/ and
                             the inputs build_peers.py and build_site_data.py read (raw/cbsa, raw/geo, raw/lodes, raw/acs, data/)
  test/                      browser tests (Playwright)
port_web.py                  turns the template into the engine page (build/tool.html): data, search, figures, map, downloads
page/build_page.py           the page itself, web/index.html, in the Field Guide design: the engine page's script with its
                             own render, report and start-up, the layout and styles, and redirects at web/preview/
web_fieldguide.js            the page's sentence at the top, biggest gaps, income figures, render() and start-up
web_viz.js                   the chart above every table (HTML bars, also used in the report)
web_report.js                the report builder (presets, sections, categories, kept in the link) and the report file
web_suggest.js               suggested areas: the form, review links, approved areas in search
web_download.js              report, CSV and link downloads
web_map.js                   the street map (MapLibre + OpenFreeMap), hover and edge street names
web_guide.js                 the guide card at the top of the page
web_chart.js                 the old retention chart, kept in the engine page (the page draws its own charts)
web_feedback.js              the Suggestions and corrections box
web_programs.js              Programs and designations table and the map's program shading
web_stores.js                Stores here, and Room for new stores (restaurants split by service, gyms by count)
web_tax.js                   Sales tax on leaked spending, and the state-by-state coverage table
web_peers.js                 Compared with similar places, and the visitor-economy flag
web_region.js                The surrounding region: leakage and surplus within 10, 25 and 50 miles
web_gate.js                  the email step before the first download, and anonymous usage counts
web/README.md                the site repository's README
web/apps-script/Code.gs      the Google Apps Script behind suggested areas, messages, download records and usage counts
                             (copy of the live one)
```

The folders the scripts read (`data/`, `raw_ec/`, `raw_wof/`, `bls/`, `national/raw/`) and the ones they write
(`national/out/`, `national/site/data/`, `national/tmp_geo*/`, `web/index.html`, `web/data/`) are in `.gitignore`.

## Building

Needs Python 3 with shapely 2, duckdb, openpyxl and pyxlsb (`pip install -r requirements.txt`) and `mapshaper`
(`npm install -g mapshaper`). The current build used Python 3.13, shapely 2.2.0 and mapshaper 0.6.102. Put the inputs where INPUTS.md says, then:

```
./build.sh                      # everything; the first Who's On First extract is the slow step
./build.sh site                 # only package the data and regenerate the page
```

`build.sh` runs, from the repository root:

1. `national/extract_napcs.py` → `raw_ec/keep/napcs_us_44_72_81.json`, and `national/fetch_ce_detail.py` →
   `data/ce/<item>_<bracket>.csv` for the detailed items
2. `national/ce_restaurant_split.py bls/diary24.zip` → `national/out/ce_fsr_share.json`
3. `national/extract_nonemployer.py`, `extract_overlays.py`, `extract_stores.py` and `extract_health.py` →
   `national/out/nonemployer.json`, `overlays.json`, `stores.json` and `health.json` (`extract_stores.py` and
   `extract_health.py` download their own inputs; the others need theirs in place). `extract_visitor.py` →
   `visitor.json` runs after the national build (step 6), since it reads tracts.csv, and cuts its lodging places from
   the same Overture release
   `extract_local.py` → `national/out/local.json` and `national/out/local_shapes/` (fetches its own layers, listed in
   `local_sources.py`; see INPUTS.md)
4. `national/extract_urban.py` → `national/out/urban_share.json`, then `rural_factors.py` → `rural_factors.json`
   (on the current inputs: restaurants 0.83, alcohol 0.61, personal care 0.73, apparel 0.75, tobacco 1.73; 80.0% of
   people urban, Census's own figure)
5. `national/build_national.py` → `national/out/tracts.csv`, `build_meta.json`
6. `national/build_neighborhoods.py` → `national/out/areas/<fips>.json` (caches `national/out/wof_areas.json`;
   delete it after replacing the Who's On First database)
7. `national/build_peers.py` → `national/out/peers.json` (24 classes on the current build)
8. `national/build_site_data.py` → `national/site/data/index.json`, `national/site/data/st/<fips>.json`
9. `port_web.py` → `build/tool.html`; `build.sh` then copies `national/site/data` to `web/data`, and `page/build_page.py`
   writes `web/index.html` and the redirects at `web/preview/` (old preview links open the same area on the page)
10. `national/state_validate.py` and `state_validate_coverage.py` compare the sales estimates with the taxable sales that
   21 states publish by city or county and kind of business (`il_validate.py` does Illinois in more detail). On the
   current build, restaurants and bars: log correlation 0.85–0.99 by state, typical median ratio 1.04.
11. `national/ss_check.py` prints South Shore's figures. On the current build: 15 tracts, 25,043 households,
   retention 0.34 to 0.41, net projected leakage $242M to $272M (13 categories; child care is shown apart).

## Testing

```
cd national/test && npm install
CHROME=/path/to/chromium node web.mjs        # suggestions, review links, downloads (mock Apps Script)
CHROME=/path/to/chromium node map.mjs        # map, hover, street names, no-tiles and no-WebGL fallbacks
CHROME=/path/to/chromium node guide.mjs      # the guide card
CHROME=/path/to/chromium node headline.mjs   # headline wording for destination, low-retention and mixed areas
CHROME=/path/to/chromium node stats.mjs      # the residents / households / jobs tiles at phone to desktop widths
CHROME=/path/to/chromium node jobs.mjs       # the jobs-by-industry table, tracts CSV and report (all 20 sectors)
CHROME=/path/to/chromium node page.mjs       # the page: sentence and income wording, fit at all widths, 14 categories, charts,
                                             # stores rows, median, report builder and its link, downloads, search, old links
CHROME=/path/to/chromium node feedback.mjs   # the Suggestions and corrections box (mock Apps Script)
CHROME=/path/to/chromium node commute.mjs    # the commuting line for a few areas
CHROME=/path/to/chromium node stores.mjs     # Stores here, and the store and program columns in the CSV and report
CHROME=/path/to/chromium node programs.mjs   # Programs and designations, and the map's program shading (real tiles)
CHROME=/path/to/chromium node tax.mjs        # Sales tax on leaked spending in twelve states, and the coverage table
CHROME=/path/to/chromium node labels.mjs     # search results: place names with their kind (City, Village, County)
CHROME=/path/to/chromium node region.mjs     # similar places, the surrounding region and the visitor flag for seven areas
CHROME=/path/to/chromium node newcats.mjs    # fitness and child care, health-care counts, stores against spending
CHROME=/path/to/chromium node gate.mjs       # the email step before the first download, and usage counts (mock Apps Script)
```

`CHROME` is any Chromium or Chrome binary (`npx playwright install chromium` downloads one). The map test loads real
street tiles from OpenFreeMap. The others serve the libraries from `node_modules` and mock the Apps Script, so
they pass offline; the map then shows its no-tiles note.

## Publishing

If `Code.gs` changed, deploy it first (below): a page that sends a new kind of request to the old script loses those
requests. Then copy `web/index.html`, `web/data/`, `web/README.md`, `web/apps-script/Code.gs` and `web/preview/` (as `preview/`, the
redirects for old preview links) into the site repository and push.
GitHub Pages republishes in a minute or two. If `Code.gs` changed, paste it into the Apps Script editor bound to the
suggestions sheet, save, then Deploy → Manage deployments → edit → New version, so the web app address stays the same.

## Changing the page

Edit `national/site/index.html`, the `web_*.js` files or `page/build_page.py`, never `web/index.html` or `build/tool.html`,
which the build overwrites. The page keeps the engine page's element ids, so the engine's functions fill it.
`port_web.py` is a list of exact-text replacements; each one fails loudly if its text is missing, so a template edit
that breaks one shows up at once.
