/**
 * Neighborhood Spending Gaps: suggested areas, and suggestions and corrections.
 *
 * This script is bound to the "Neighborhood Spending Gaps: suggested areas" Google Sheet and is deployed
 * as a web app (Execute as: Me; Who has access: Anyone). The public site talks to it:
 *
 *   POST                         a suggested area from the site (JSON sent as text/plain)
 *   GET ?a=approved              approved areas, which the site adds to everyone's search
 *   GET ?a=get&id=ID             one suggestion, for the "see it on the map" link
 *   GET ?a=status&ids=ID,ID      statuses of the suggestions a visitor made in their own browser
 *   POST {review:1, id, act, t}  approve or decline, from the site's review link in the email (act is
 *                                approve or decline; t is that action's signed token)
 *   POST {feedback:1, kind, msg, email, link}   a message from the "Suggestions and corrections" box; it goes to
 *                                the Feedback tab (created on first use) and is emailed, with Reply-To set to
 *                                the sender's address when they gave one
 *
 * Each suggestion is a row on the Suggestions tab. Its Status (pending, approved, declined, removed) is
 * the only thing that decides whether it shows on the site, so changing it in the sheet by hand works too:
 * set an approved area to "removed" to take it off the site. A review link cannot change a removed row.
 *
 * Script properties (Project Settings > Script properties); setup() creates the first three:
 *   SHEET_ID    the sheet this script writes to
 *   NOTIFY      who gets the emails (comma-separated; defaults to the script owner)
 *   SECRET      signs the review links (changing it invalidates links already sent)
 *   accepted:<date>, emails:<date>   per-day counters behind the daily limits (kept two days)
 */

var SITE = 'https://mjkelley00-mjk.github.io/neighborhood-spending-gaps/';
var TAB = 'Suggestions';
var HEAD = ['Received', 'ID', 'Status', 'Name', 'City', 'State', 'Tracts', 'Note from the person suggesting it',
            'See it on the map', 'Reviewed', 'Tract list'];
var COL = {at: 1, id: 2, status: 3, name: 4, city: 5, st: 6, n: 7, note: 8, link: 9, reviewed: 10, tracts: 11};
var STATUSES = ['pending', 'approved', 'declined', 'removed'];
// stored as plain text, so a tract ID keeps its leading zero and a name like "3/4" is not read as a date
var TEXT_COLS = [COL.id, COL.name, COL.city, COL.st, COL.note, COL.tracts];
var STATES = {'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL',
  '13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
  '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN',
  '48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'};
var MAX_TRACTS = 2500;   // a whole large county; the Tract list cell holds about 4,000
var DAILY_MAX = 200;     // suggestions accepted per day, all visitors together
var EMAIL_MAX = 40;      // notification emails per day; after that, one "more are waiting" email
var TZ = 'America/Chicago';
var FB_TAB = 'Feedback';
var FB_HEAD = ['Received', 'About', 'Message', 'Reply to', 'Area they were looking at', 'Status'];
var FB_KINDS = {idea: 'An idea for the site', data: 'A number looks wrong', bug: "Something isn't working", other: 'Something else'};
var FB_DAILY_MAX = 100;  // messages accepted per day, all visitors together

// ---------------------------------------------------------------- setup, run once from the editor
function setup() {
  // only the owner, from the editor: a web-app visitor has no active user
  if (Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) { throw new Error('not allowed'); }
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
  TEXT_COLS.forEach(function (c) { sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@'); });
  sh.setColumnWidth(COL.at, 130); sh.setColumnWidth(COL.id, 120); sh.setColumnWidth(COL.name, 180);
  sh.setColumnWidth(COL.note, 260); sh.setColumnWidth(COL.link, 260); sh.setColumnWidth(COL.tracts, 200);
  sh.getRange(1, COL.tracts, sh.getMaxRows(), 1).setWrap(false);
  Logger.log('Ready. Emails go to: ' + props.getProperty('NOTIFY'));
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
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret) { return null; }                         // no secret, no valid links
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

// ---------------------------------------------------------------- GET
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.a === 'approved') { return json_({areas: approved_()}); }
  if (p.a === 'get') {
    var r = find_(p.id);
    if (!r) { return json_({error: 'not_found'}); }
    return json_({id: r.id, name: r.name, city: r.city, st: stCode_(r.st), tracts: r.tracts, status: r.status});
  }
  if (p.a === 'status') {
    var ids = String(p.ids || '').split(',').slice(0, 50), out = {}, all = rows_();
    var byId = {};
    all.forEach(function (r) { byId[r.id] = r.status; });
    ids.forEach(function (id) { if (byId[id]) { out[id] = byId[id]; } });
    return json_({status: out});
  }
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
  if (b.review) { return review_(b); }
  if (b.feedback) { return feedback_(b); }
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
    var sh = sheet_(), row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) { sh.insertRowsAfter(sh.getMaxRows(), 200); }
    TEXT_COLS.forEach(function (c) { sh.getRange(row, c).setNumberFormat('@'); });
    sh.getRange(row, COL.status).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
    sh.getRange(row, 1, 1, HEAD.length).setValues([[Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), id, 'pending',
      name, city, st + ' ' + STATES[st], tracts.length, note, SITE + '#sg-' + id, '', tracts.join(' ')]]);
    SpreadsheetApp.flush();                             // saved before the next request reads the last row
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
  var place = s.name + (s.city ? ', ' + s.city : '') + ' (' + STATES[s.st] + ')';
  var tracts = s.n + ' census tract' + (s.n === 1 ? '' : 's');
  var view = SITE + '#sg-' + s.id;
  // the review link opens the area on the site with Approve and Decline buttons; it carries both signed
  // tokens, so keep it to yourself. The plain map link is safe to forward.
  var review = SITE + '#review=' + s.id + '.' + token_(s.id, 'approve') + '.' + token_(s.id, 'decline');
  var html = '<div style="font:15px/1.5 Arial,sans-serif;color:#14212b">' +
    '<p>Someone suggested a new area for Neighborhood Spending Gaps:</p>' +
    '<p style="font-size:18px;margin:12px 0"><b>' + esc_(place) + '</b><br><span style="color:#5a6b78;font-size:14px">' +
    tracts + '</span></p>' +
    (s.note ? '<p style="color:#5a6b78">Their note: “' + esc_(s.note) + '”</p>' : '') +
    '<p><a href="' + review + '" style="background:#0f7d7a;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Review it on the map</a></p>' +
    '<p style="color:#5a6b78;font-size:13px">The review link opens the area with Approve and Decline buttons, so keep it to yourself. ' +
    'To ask someone who knows the area, forward this link instead; it only shows the area: <a href="' + view + '">' + view + '</a></p>' +
    '<p style="color:#5a6b78;font-size:13px">Approving adds it to everyone\'s search on the site, labeled as a suggested area. ' +
    'Every suggestion is also in <a href="' + sheetUrl + '">the sheet</a>, where you can change its status later.</p></div>';
  MailApp.sendEmail({to: to, name: 'Neighborhood Spending Gaps', subject: 'Suggested area: ' + place, htmlBody: html,
    body: 'Suggested area: ' + place + ', ' + tracts + '.\nReview it on the map (keep this link to yourself): ' + review +
          '\nMap only, safe to forward: ' + view + '\nThe sheet: ' + sheetUrl});
}

// ---------------------------------------------------------------- review, from the site's review link
function review_(b) {
  var id = String(b.id || ''), act = String(b.act || ''), t = String(b.t || '');
  var tok = (act === 'approve' || act === 'decline') ? token_(id, act) : null;
  if (!tok || t !== tok) { return json_({error: 'invalid_link'}); }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { return json_({error: 'busy'}); }
  try {
    var r = find_(id);
    if (!r) { return json_({error: 'not_found'}); }
    if (r.status === 'removed') { return json_({error: 'removed'}); }   // taken off in the sheet; change it there
    var status = act === 'approve' ? 'approved' : 'declined';
    var sh = sheet_();
    sh.getRange(r.row, COL.status).setValue(status);
    sh.getRange(r.row, COL.reviewed).setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('approved');
    return json_({ok: true, status: status});
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- POST: suggestions and corrections
function fbSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(FB_TAB);
  if (!sh) {
    sh = ss.insertSheet(FB_TAB);
    sh.getRange(1, 1, 1, FB_HEAD.length).setValues([FB_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 130); sh.setColumnWidth(2, 170); sh.setColumnWidth(3, 420); sh.setColumnWidth(4, 200); sh.setColumnWidth(5, 260);
    sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setWrap(true);
  }
  return sh;
}
function feedback_(b) {
  if (b.website) { return json_({ok: true}); }                              // the form's hidden trap field
  var kind = FB_KINDS[b.kind] ? String(b.kind) : 'other';
  var raw = String(b.msg == null ? '' : b.msg).replace(/\r\n?/g, '\n').trim();
  if (raw.length < 5 || raw.length > 2000) { return json_({error: 'bad_request'}); }
  // keep line breaks in the message; strip other control characters; never let the cell start a formula
  var msg = raw.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
  if (/^[=+\-@]/.test(msg)) { msg = "'" + msg; }
  var email = String(b.email || '').trim().slice(0, 120);
  if (email && !/^[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}$/i.test(email)) { email = ''; }
  var link = String(b.link || '');
  link = link.indexOf(SITE) === 0 && link.length <= 1500 ? link : '';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { return json_({error: 'busy'}); }
  try {
    if (bump_('feedback') > FB_DAILY_MAX) { return json_({error: 'daily_limit'}); }
    var sh = fbSheet_(), row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) { sh.insertRowsAfter(sh.getMaxRows(), 200); }
    sh.getRange(row, 1, 1, FB_HEAD.length).setNumberFormat('@').setValues([[
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), FB_KINDS[kind], msg, email, link, 'new']]);
    SpreadsheetApp.flush();
    notifyFeedback_({kind: kind, msg: bare_(msg), email: email, link: link, url: sh.getParent().getUrl() + '#gid=' + sh.getSheetId()});
    return json_({ok: true});
  } finally {
    lock.releaseLock();
  }
}
function notifyFeedback_(f) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY');
  if (!to) { return; }
  var n = bump_('emails');
  if (n > EMAIL_MAX + 1) { return; }
  if (n === EMAIL_MAX + 1) {
    MailApp.sendEmail({to: to, name: 'Neighborhood Spending Gaps', subject: 'More messages are waiting',
      body: 'More messages and suggested areas came in today than the ' + EMAIL_MAX + ' emails a day this sends. The rest are in the sheet: ' + f.url});
    return;
  }
  var first = f.msg.replace(/\s+/g, ' ');
  var subject = FB_KINDS[f.kind] + ': ' + (first.length > 60 ? first.slice(0, 57) + '…' : first);
  var html = '<div style="font:15px/1.5 Arial,sans-serif;color:#14212b">' +
    '<p style="color:#5a6b78;margin:0 0 6px">' + esc_(FB_KINDS[f.kind]) + ', from the Suggestions and corrections box</p>' +
    '<p style="white-space:pre-wrap;font-size:16px;margin:0 0 14px">' + esc_(f.msg) + '</p>' +
    (f.link ? '<p><a href="' + esc_(f.link) + '">The area they were looking at</a></p>' : '') +
    '<p style="color:#5a6b78;font-size:13px">' + (f.email ? 'Reply to this email to answer them at ' + esc_(f.email) + '.' : 'They left no address, so there is no one to reply to.') +
    ' Every message is also in <a href="' + f.url + '">the sheet</a>.</p></div>';
  var mail = {to: to, name: 'Neighborhood Spending Gaps', subject: subject, htmlBody: html,
    body: FB_KINDS[f.kind] + '\n\n' + f.msg + (f.link ? '\n\nThe area they were looking at: ' + f.link : '') +
          (f.email ? '\n\nReply to: ' + f.email : '') + '\n\nThe sheet: ' + f.url};
  if (f.email) { mail.replyTo = f.email; }
  MailApp.sendEmail(mail);
}

// Clears the cached approved list when the Status column is edited by hand (a simple trigger: it runs on
// every edit in the sheet without being installed). Without it the site catches up within two minutes.
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === TAB && e.range.getColumn() <= COL.status &&
      e.range.getLastColumn() >= COL.status) {
    CacheService.getScriptCache().remove('approved');
  }
}
