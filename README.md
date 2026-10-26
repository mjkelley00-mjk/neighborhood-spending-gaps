# Neighborhood Spending Gaps

What residents spend and what local stores sell, for any US neighborhood, census tract, ZIP code, city or county, compared with the national pattern. Built only from public data.

Live page: https://mjkelley00-mjk.github.io/neighborhood-spending-gaps/

## What's here

```
index.html            the page (one file: styles, map, figures, downloads, suggestions)
data/index.json       states, national calibration, store benchmarks, source names
data/st/<fips>.json   one file per state: tracts, places, ZIP codes, named areas, counties, map shapes
apps-script/Code.gs   the Google Apps Script behind suggested areas and messages (a copy; the live one is in the sheet)
preview/              two design previews (Almanac, Field Guide) on the same data, while the redesign is chosen; not indexed
```

The page's "Method and limits" section explains how the figures are made and lists every source.

## Links

- `#t=<tract ids>&n=<name>` reopens a selection. The address bar always holds the current one, and "Copy link to this selection" copies it.
- `#sg-<id>` opens a suggested area. It's safe to forward.
- `#review=<id>.<token>.<token>` opens a suggested area with Approve and Decline buttons. Only the review email has it. The tokens are signed by the script and don't expire, so anyone holding the link can approve or decline that suggestion: keep it to yourself. A review link can't change a row set to `removed` in the sheet.

## Suggested areas

Anyone can select tracts and suggest them as a named area. The page sends the suggestion to a Google Apps Script web app bound to the sheet **Neighborhood Spending Gaps: suggested areas**. The script:

1. adds a row to the sheet's Suggestions tab with status `pending`;
2. emails the addresses in its `NOTIFY` script property with a review link, which opens the area on the page with Approve and Decline buttons, and a map-only link that is safe to forward (at most 40 emails a day; after that, one "more are waiting" email);
3. serves approved areas to the page, which adds them to everyone's search labeled "Approved suggestion".

The status in the sheet decides everything: change a row to `approved`, `declined` or `removed` by hand at any time. The page keeps a visitor's own suggestions on their device (browser storage) so they can see them before review. It asks nothing about who is suggesting and saves nothing about them.

## Suggestions and corrections

The box near the bottom of the page sends a message (an idea, a figure that looks wrong, something broken) to the same script. It adds a row to the sheet's **Feedback** tab, which the script creates the first time a message arrives, and emails the `NOTIFY` addresses. If the sender typed an email address, the email's Reply-To is set to it, so replying answers them directly; that address is the only thing kept about them. If they ticked the box, the message links to the area they were looking at. The tab's Status column starts at `new`; use it however you like. Messages count toward the same 40-emails-a-day limit as suggested areas, and at most 100 messages are accepted a day.

## Downloads and usage counts

The first download in a browser asks for an email address; role, organization and an updates opt-in are optional. Every download adds a row to the sheet's **Leads** tab (created on first use): the address, role, organization, whether they want updates, what they downloaded, the area and its link. The first download from an address is emailed to the first address in `NOTIFY` only, at most 5 every six hours (then one "more are on the Leads tab" email); these notices are counted apart from the 40 a day for suggested areas and messages. The notice says nothing a visitor typed beyond their address, and is skipped unless the account's daily email quota, which counts each recipient, still has room for the rest of the day's 41 suggestion and message emails to every `NOTIFY` address, plus 5, so downloads can't crowd those out. On a personal Gmail account the quota is about 100 recipients a day: with one `NOTIFY` address the notices send all day (41 + 5 = 46 held back); with two, 87 are held back (82 + 5), so about 13 notices (fewer if the account sends other mail) go out each day and then they stop (each suggestion email lowers the quota and the hold-back alike); with three or more, the hold-back exceeds the quota and download notices never send. A Google Workspace account allows about 1,500. Nobody confirms the addresses, so before sending updates, email each address that ticked the box and ask them to confirm. At most 250 download rows are accepted every six hours; past that a download isn't recorded, so that person's next download shows as their first. Columns you add to the right of the Leads or Usage columns are kept.

The page also counts which areas are looked at (a selection kept for four seconds) and downloaded: one row on the **Usage** tab with the date, kind, state, area name and number of tracts, and no address. At most 500 rows are accepted every six hours, so the tab grows by at most about 10,000 cells a day, and Leads by about as much at its limit. Google Sheets allows 10 million cells per spreadsheet, so check the size now and then and copy old rows elsewhere.

## The script

The script's address is the `SUGGEST_API` constant in `index.html`. If you redeploy the script as a **new** deployment, update that constant; if you edit the existing deployment (Deploy → Manage deployments → edit → New version), the address stays the same.

To add another reviewer, add their address to the `NOTIFY` script property (comma-separated) and give them edit access to the sheet. Each address raises the email hold-back above by 41; see Downloads and usage counts before adding a third on a personal Gmail account.

### Setting it up again from scratch

1. Make a Google Sheet, open Extensions → Apps Script, and paste in `apps-script/Code.gs`.
2. Run `setup()` from the editor and grant access. It creates the Suggestions tab and the `SECRET`, `NOTIFY` and `SHEET_ID` script properties. Changing `SECRET` invalidates every review link already sent; run `clearSecretCache()` from the editor afterwards so the change applies at once (otherwise the script keeps the old one for up to six hours).
3. Deploy → New deployment → Web app, execute as **Me**, access **Anyone**. Copy the web app URL (it ends in `/exec`).
4. Put that URL in `SUGGEST_API` in `index.html` and push. Until then the page says suggestions are off.
5. If the site moves to another address, change `SITE` at the top of the script, then Deploy → Manage deployments → edit → New version.

## Updating the data

`index.html` and `data/` are generated by a separate build pipeline, kept in a private repository, from the public sources listed in the page's "Method and limits" section. Edit the page there rather than here, since a rebuild overwrites `index.html`. To update, rebuild, copy `index.html` and `data/` here and push; GitHub Pages republishes within a minute or two.
