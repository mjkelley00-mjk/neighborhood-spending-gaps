/**
 * Neighborhood Spending Gaps: suggested areas.
 *
 * This script is bound to the "Neighborhood Spending Gaps: suggested areas" Google Sheet and is deployed
 * as a web app (Execute as: Me; Who has access: Anyone). The public site talks to it:
 *
 *   POST                         a suggested area from the site (JSON sent as text/plain)
 *   GET ?a=approved              approved areas, which the site adds to everyone's search
 *   GET ?a=get&id=ID             one suggestion, for the "see it on the map" link
 *   GET ?a=status&ids=ID,ID      statuses of the suggestions a visitor made in their own browser
 *   GET ?a=review&id=ID&do=approve|decline&t=TOKEN
 *                                the confirmation page behind the Approve and Decline links in the email
 *
 * Each suggestion is a row on the Suggestions tab. Its Status (pending, approved, declined, removed) is
 * the only thing that decides whether it shows on the site, so changing it in the sheet by hand works too:
 * set an approved area to "removed" to take it off the site.
 *
 * Script properties (Project Settings > Script properties), set by setup():
 *   NOTIFY      who gets the emails (comma-separated; defaults to the script owner)
 *   SECRET      signs the Approve and Decline links; setup() creates it
 *   WEBAPP_URL  the web app's /exec address, for the links in the email
 */

var SITE = 'https://mjkelley00-mjk.github.io/neighborhood-spending-gaps/';
var TAB = 'Suggestions';
var HEAD = ['Received', 'ID', 'Status', 'Name', 'City', 'State', 'Tracts', 'Note from the person suggesting it',
            'See it on the map', 'Reviewed', 'Tract list'];
var COL = {at: 1, id: 2, status: 3, name: 4, city: 5, st: 6, n: 7, note: 8, link: 9, reviewed: 10, tracts: 11};
var STATUSES = ['pending', 'approved', 'declined', 'removed'];
var STATES = {'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL',
  '13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
  '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN',
  '48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'};
var MAX_TRACTS = 2500;   // a whole large county; the Tract list cell holds about 4,000
var DAILY_MAX = 200;     // suggestions accepted per day, all visitors together
var EMAIL_MAX = 40;      // notification emails per day; after that, one "more are waiting" email
var TZ = 'America/Chicago';

// ---------------------------------------------------------------- setup, run once from the editor
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  if (!props.getProperty('NOTIFY')) {
    props.setProperty('NOTIFY', Session.getEffectiveUser().getEmail());
  }
  var sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(TAB) : ss.insertSheet(TAB);
  }
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sh.getRange(2, COL.status, sh.getMaxRows() - 1, 1).setDataValidation(rule);
  sh.setColumnWidth(COL.at, 130); sh.setColumnWidth(COL.id, 120); sh.setColumnWidth(COL.name, 180);
  sh.setColumnWidth(COL.note, 260); sh.setColumnWidth(COL.link, 260); sh.setColumnWidth(COL.tracts, 200);
  sh.getRange(1, COL.tracts, sh.getMaxRows(), 1).setWrap(false);
  Logger.log('Ready. Emails go to: ' + props.getProperty('NOTIFY') +
             '. After deploying, set WEBAPP_URL to the web app address ending in /exec.');
}

// ---------------------------------------------------------------- helpers
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(TAB);
}
function clean_(s, max) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;            // never let a sheet cell start a formula
}
function bare_(s) { return String(s || '').replace(/^'/, ''); }
function esc_(s) {
  return bare_(s).replace(/[&<>"']/g, function (c) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
  });
}
function token_(id, act) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET') || '';
  var sig = Utilities.computeHmacSha256Signature(id + '|' + act, secret);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 32);
}
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function bump_(kind) {                                  // per-day counters, kept for two days
  var props = PropertiesService.getScriptProperties();
  var key = kind + ':' + today_();
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  var keep = [key, kind + ':' + Utilities.formatDate(new Date(Date.now() - 864e5), TZ, 'yyyy-MM-dd')];
  props.getKeys().forEach(function (k) {
    if (k.indexOf(kind + ':') === 0 && keep.indexOf(k) < 0) { props.deleteProperty(k); }
  });
  return n;
}
function rows_() {
  var sh = sheet_(), last = sh.getLastRow();
  if (last < 2) { return []; }
  return sh.getRange(2, 1, last - 1, HEAD.length).getValues().map(function (v, i) {
    return {row: i + 2, at: v[COL.at - 1], id: String(v[COL.id - 1]), status: String(v[COL.status - 1] || 'pending').trim().toLowerCase(),
            name: bare_(v[COL.name - 1]), city: bare_(v[COL.city - 1]), st: String(v[COL.st - 1]).replace(/^'/, ''),
            note: bare_(v[COL.note - 1]), tracts: String(v[COL.tracts - 1] || '').split(/[^0-9]+/).filter(Boolean)};
  });
}
function find_(id) {
  if (!/^g[0-9a-f]{12}$/.test(String(id || ''))) { return null; }
  var all = rows_();
  for (var i = 0; i < all.length; i++) { if (all[i].id === id) { return all[i]; } }
  return null;
}
function stCode_(v) {                                  // the State column shows "17 IL"
  var m = String(v).match(/^(\d{2})/);
  return m ? m[1] : '';
}
function webappUrl_() {
  return PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl();
}

// ---------------------------------------------------------------- GET
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.a === 'approved') { return json_({areas: approved_()}); }
  if (p.a === 'get') {
    var r = find_(p.id);
    if (!r || r.status === 'declined') { return json_({error: 'not_found'}); }
    return json_({id: r.id, name: r.name, city: r.city, st: stCode_(r.st), tracts: r.tracts, status: r.status});
  }
  if (p.a === 'status') {
    var ids = String(p.ids || '').split(',').slice(0, 50), out = {}, all = rows_();
    var byId = {};
    all.forEach(function (r) { byId[r.id] = r.status; });
    ids.forEach(function (id) { if (byId[id]) { out[id] = byId[id]; } });
    return json_({status: out});
  }
  if (p.a === 'review') { return reviewPage_(p.id, p['do'], p.t); }
  return json_({ok: true, service: 'Neighborhood Spending Gaps suggested areas'});
}

function approved_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('approved');
  if (hit) { return JSON.parse(hit); }
  var list = rows_().filter(function (r) { return r.status === 'approved' && r.tracts.length; }).map(function (r) {
    return {id: r.id, name: r.name, city: r.city, st: stCode_(r.st), tracts: r.tracts};
  });
  var s = JSON.stringify(list);
  if (s.length < 90000) { cache.put('approved', s, 120); }
  return list;
}

// ---------------------------------------------------------------- POST: a new suggestion
function doPost(e) {
  var b;
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({error: 'bad_request'}); }
  if (b.website) { return json_({ok: true, id: 'g000000000000'}); }       // the form's hidden trap field
  var name = clean_(b.name, 80), city = clean_(b.city, 60), note = clean_(b.note, 300);
  var st = String(b.st || '');
  var tracts = (Array.isArray(b.tracts) ? b.tracts : []).map(String);
  if (!bare_(name) || !STATES[st] || !tracts.length || tracts.length > MAX_TRACTS ||
      tracts.some(function (t) { return !/^\d{11}$/.test(t) || t.slice(0, 2) !== st; })) {
    return json_({error: 'bad_request'});
  }
  tracts = tracts.filter(function (t, i, a) { return a.indexOf(t) === i; }).sort();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { return json_({error: 'busy'}); }
  try {
    var key = st + '|' + bare_(name).toLowerCase() + '|' + tracts.join(',');
    var dup = rows_().filter(function (r) {
      return r.status !== 'declined' && r.status !== 'removed' &&
             stCode_(r.st) + '|' + r.name.toLowerCase() + '|' + r.tracts.join(',') === key;
    })[0];
    if (dup) { return json_({ok: true, id: dup.id, status: dup.status}); }
    if (bump_('accepted') > DAILY_MAX) { return json_({error: 'daily_limit'}); }
    var id = 'g' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    var sh = sheet_();
    sh.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), id, 'pending', name, city,
                  st + ' ' + STATES[st], tracts.length, note, SITE + '#sg-' + id, '', tracts.join(' ')]);
    notify_({id: id, name: bare_(name), city: bare_(city), st: st, n: tracts.length, note: bare_(note)});
    return json_({ok: true, id: id, status: 'pending'});
  } finally {
    lock.releaseLock();
  }
}

function notify_(s) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY');
  if (!to) { return; }
  var n = bump_('emails');
  if (n > EMAIL_MAX + 1) { return; }
  var sheetUrl = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl();
  if (n === EMAIL_MAX + 1) {
    MailApp.sendEmail({to: to, name: 'Neighborhood Spending Gaps',
      subject: 'More suggested areas are waiting',
      body: 'More areas were suggested today than the ' + EMAIL_MAX + ' emails a day this sends. The rest are in the sheet: ' + sheetUrl});
    return;
  }
  var url = webappUrl_();
  var link = function (act) { return url + '?a=review&id=' + s.id + '&do=' + act + '&t=' + token_(s.id, act); };
  var place = s.name + (s.city ? ', ' + s.city : '') + ' (' + STATES[s.st] + ')';
  var view = SITE + '#sg-' + s.id;
  var html = '<div style="font:15px/1.5 Arial,sans-serif;color:#14212b">' +
    '<p>Someone suggested a new area for Neighborhood Spending Gaps:</p>' +
    '<p style="font-size:18px;margin:12px 0"><b>' + esc_(place) + '</b><br><span style="color:#5a6b78;font-size:14px">' +
    s.n + ' census tract' + (s.n === 1 ? '' : 's') + '</span></p>' +
    (s.note ? '<p style="color:#5a6b78">Their note: “' + esc_(s.note) + '”</p>' : '') +
    '<p><a href="' + view + '">See it on the map</a></p>' +
    '<p><a href="' + link('approve') + '" style="background:#0f7d7a;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Approve</a>' +
    ' &nbsp; <a href="' + link('decline') + '" style="color:#d9573f">Decline</a></p>' +
    '<p style="color:#5a6b78;font-size:13px">Approving adds it to everyone\'s search on the site, labeled as a suggested area. ' +
    'You can forward the map link to anyone who knows the area; it only shows the area. ' +
    'Every suggestion is also in <a href="' + sheetUrl + '">the sheet</a>, where you can change its status later.</p></div>';
  MailApp.sendEmail({to: to, name: 'Neighborhood Spending Gaps', subject: 'Suggested area: ' + place, htmlBody: html,
    body: 'Suggested area: ' + place + ', ' + s.n + ' tracts.\nSee it on the map: ' + view +
          '\nApprove: ' + link('approve') + '\nDecline: ' + link('decline') + '\nThe sheet: ' + sheetUrl});
}

// ---------------------------------------------------------------- review page and action
function reviewPage_(id, act, t) {
  var r = find_(id);
  var ok = r && (act === 'approve' || act === 'decline') && t === token_(id, act);
  var t2 = HtmlService.createTemplate(
    '<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px/1.5 Arial,sans-serif;color:#14212b;max-width:520px;margin:40px auto;padding:0 16px}' +
    'h1{font-size:22px;margin:0 0 4px}.m{color:#5a6b78}button{font:600 15px Arial,sans-serif;padding:10px 18px;border-radius:6px;border:0;cursor:pointer}' +
    '.go{background:#0f7d7a;color:#fff}.no{background:#d9573f;color:#fff}a{color:#0f7d7a}</style></head><body>' +
    '<? if (!ok) { ?><h1>This link is not valid</h1><p class="m">It may be incomplete. Open the suggestion in the sheet instead.</p>' +
    '<? } else { ?><p class="m">Suggested area</p><h1><?= place ?></h1><p class="m"><?= n ?> census tracts · now <b id="st"><?= status ?></b></p>' +
    '<p><a href="<?= view ?>">See it on the map</a></p>' +
    '<p id="act"><button class="<?= act === "approve" ? "go" : "no" ?>" onclick="go()"><?= act === "approve" ? "Approve it" : "Decline it" ?></button></p>' +
    '<p id="msg" class="m"></p>' +
    '<script>function go(){document.getElementById("act").hidden=true;document.getElementById("msg").textContent="Saving…";' +
    'google.script.run.withSuccessHandler(function(s){document.getElementById("st").textContent=s;' +
    'document.getElementById("msg").textContent=s==="approved"?"Approved. It shows in everyone\'s search within a couple of minutes.":"Declined. It will not show on the site.";})' +
    '.withFailureHandler(function(){document.getElementById("act").hidden=false;document.getElementById("msg").textContent="That did not save. Try again, or change the status in the sheet.";})' +
    '.applyReview(<?!= JSON.stringify(id) ?>,<?!= JSON.stringify(act) ?>,<?!= JSON.stringify(t) ?>);}</script><? } ?></body></html>');
  t2.ok = !!ok;
  t2.id = String(id || ''); t2.act = String(act || ''); t2.t = String(t || '');
  t2.place = r ? r.name + (r.city ? ', ' + r.city : '') + ' (' + (STATES[stCode_(r.st)] || '') + ')' : '';
  t2.n = r ? r.tracts.length : 0;
  t2.status = r ? r.status : '';
  t2.view = r ? SITE + '#sg-' + r.id : SITE;
  return t2.evaluate().setTitle('Review a suggested area');
}

function applyReview(id, act, t) {
  if ((act !== 'approve' && act !== 'decline') || t !== token_(id, act)) { throw new Error('invalid link'); }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = find_(id);
    if (!r) { throw new Error('not found'); }
    var status = act === 'approve' ? 'approved' : 'declined';
    var sh = sheet_();
    sh.getRange(r.row, COL.status).setValue(status);
    sh.getRange(r.row, COL.reviewed).setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    CacheService.getScriptCache().remove('approved');
    return status;
  } finally {
    lock.releaseLock();
  }
}

// Clears the cached approved list when the Status column is edited by hand (a simple trigger: it runs on
// every edit in the sheet without being installed). Without it the site catches up within two minutes.
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === TAB && e.range.getColumn() <= COL.status &&
      e.range.getLastColumn() >= COL.status) {
    CacheService.getScriptCache().remove('approved');
  }
}
