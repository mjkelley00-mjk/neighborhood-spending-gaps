# Neighborhood Spending Gaps

What residents spend and what local stores sell, for any US neighborhood, census tract, ZIP code, city or county, compared with the national pattern. Built only from public data.

Live page: https://mjkelley00-mjk.github.io/neighborhood-spending-gaps/

## What's here

```
index.html            the page (one file: styles, map, figures, downloads, suggestions)
data/index.json       states, national calibration, store benchmarks, source names
data/st/<fips>.json   one file per state: tracts, places, ZIP codes, named areas, counties, map shapes
apps-script/Code.gs   the Google Apps Script behind suggested areas (a copy; the live one is in the sheet)
```

The page's "Method and limits" section explains how the figures are made and lists every source.

## Links

- `#t=<tract ids>&n=<name>` reopens a selection. The address bar always holds the current one, and "Copy link to this selection" copies it.
- `#sg-<id>` opens a suggested area. The review email links here.

## Suggested areas

Anyone can select tracts and suggest them as a named area. The page sends the suggestion to a Google Apps Script web app bound to the sheet **Neighborhood Spending Gaps: suggested areas**. The script:

1. adds a row to the sheet's Suggestions tab with status `pending`;
2. emails the addresses in its `NOTIFY` script property with three links: see it on the map, approve, decline (at most 40 emails a day; after that, one "more are waiting" email);
3. serves approved areas to the page, which adds them to everyone's search labeled "Approved suggestion".

The status in the sheet decides everything: change a row to `approved`, `declined` or `removed` by hand at any time. The page keeps a visitor's own suggestions on their device (browser storage) so they can see them before review. It asks nothing about who is suggesting and saves nothing about them.

The script's address is the `SUGGEST_API` constant in `index.html`. If you redeploy the script as a **new** deployment, update that constant; if you edit the existing deployment (Deploy → Manage deployments → edit → New version), the address stays the same.

To add another reviewer, add their address to the `NOTIFY` script property (comma-separated) and give them edit access to the sheet.

## Updating the data

The data files are built by the scripts in the working folder this came from (`build_national.py`, `build_neighborhoods.py`, `build_site_data.py`, `ce_restaurant_split.py`). Replace `data/` with a new build and push; GitHub Pages republishes within a minute or two.
