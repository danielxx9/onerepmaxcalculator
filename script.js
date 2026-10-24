/*! script.js — One Rep Max & Strength Calculators v3 (app logic).
   Extracted verbatim from the single-file v3 build; blocks kept in
   original order. File-wide strict mode comes from block 1's directive. */
"use strict";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(msg, ms){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms || 1800);
}
async function copyText(text){
  try {
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('no clipboard api');
  } catch (e){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly','');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }
}
function downloadFile(filename, text, mime = 'text/csv;charset=utf-8'){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function shareBlob(blob, filename, text, title){
  if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] }) && navigator.share){
    try {
      await navigator.share({ files: [new File([blob], filename, { type: blob.type })], text: text, title: title });
      return true;
    } catch (e){ /* fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return false;
}

function decimalsOf(n){
  const s = String(n);
  if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) return 4;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
function roundTo(value, inc){
  if (!isFinite(value)) return NaN;
  if (!inc || inc <= 0) return value;
  const d = Math.min(8, decimalsOf(inc) + 3);
  return parseFloat((Math.round(value / inc) * inc).toFixed(d));
}
function roundDp(value, dp){
  if (!isFinite(value)) return NaN;
  return parseFloat(value.toFixed(dp));
}
function fmt(value, dp){
  if (value === null || value === undefined || !isFinite(value)) return '—';
  const d = (dp === undefined) ? Settings.get('decimals') : dp;
  return value.toFixed(d);
}
const NUMERIC_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validISO(s){
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0,10) === s;
}
function readNum(el, opts){
  const o = Object.assign({ min: -Infinity, max: Infinity, label: 'Value', required: true, integer: false }, opts || {});
  if (!el) return { ok:false, value:null, msg: o.label + ' is missing.' };
  const raw = String(el.value == null ? '' : el.value).trim();
  if (raw === ''){
    if (!o.required) return { ok:true, value:null, empty:true };
    return { ok:false, value:null, msg: o.label + ' is required.' };
  }
  if (!NUMERIC_RE.test(raw)) return { ok:false, value:null, msg: o.label + ' must be a number.' };
  const v = Number(raw);
  if (!isFinite(v)) return { ok:false, value:null, msg: o.label + ' must be a finite number.' };
  if (o.integer && !Number.isInteger(v)) return { ok:false, value:null, msg: o.label + ' must be a whole number.' };
  if (v < o.min) return { ok:false, value:null, msg: o.label + ' must be at least ' + o.min + '.' };
  if (v > o.max) return { ok:false, value:null, msg: o.label + ' must be at most ' + o.max + '.' };
  return { ok:true, value:v };
}
function safe(v){ return (typeof v === 'number' && isFinite(v)) ? v : NaN; }

const Units = (function(){
  const KG_PER_LB = 0.45359237;
  const LB_PER_KG = 1 / KG_PER_LB;
  function toKg(v, unit){ return unit === 'kg' ? v : v * KG_PER_LB; }
  function fromKg(v, unit){ return unit === 'kg' ? v : v * LB_PER_KG; }
  function convert(v, from, to){
    if (from === to) return v;
    return to === 'kg' ? v * KG_PER_LB : v * LB_PER_KG;
  }
  return { KG_PER_LB, LB_PER_KG, toKg, fromKg, convert };
})();

const StorageHealth = (function(){
  let lastError = null;
  function report(err){
    lastError = err;
    updateBadge();
  }
  function ok(){ lastError = null; updateBadge(); }
  function updateBadge(){
    const el = document.getElementById('storageBadge');
    if (!el) return;
    if (lastError){
      el.className = 'pill bad';
      el.textContent = 'Storage error';
      el.title = 'localStorage write failed: ' + (lastError.message || lastError);
    } else {
      el.className = 'pill good';
      el.textContent = 'Local';
      el.title = 'All data stored locally — nothing uploaded.';
    }
  }
  return { report, ok, updateBadge };
})();

const Settings = (function(){
  const KEY = 'orm_settings_v2';
  const DEFAULTS = { unit:'kg', rounding:2.5, formula:'epley', maxReps:10, decimals:1 };
  let state = Object.assign({}, DEFAULTS);

  function load(){
    try {
      const raw = localStorage.getItem(KEY);
      if (raw){
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object'){
          if (parsed.v === 2 && parsed.settings) state = Object.assign({}, DEFAULTS, parsed.settings);
          else state = Object.assign({}, DEFAULTS, parsed);
        }
      }
    } catch (e){ StorageHealth.report(e); }
    if (state.unit !== 'kg' && state.unit !== 'lb') state.unit = 'kg';
    return state;
  }
  function persist(){
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, settings: state }));
      StorageHealth.ok();
      return true;
    } catch (e){
      StorageHealth.report(e);
      return false;
    }
  }
  function get(k){ return k ? state[k] : state; }
  function set(k, v){
    state[k] = v;
    persist();
    document.dispatchEvent(new CustomEvent('settings:change', { detail: { key: k, value: v } }));
  }
  function reset(){
    state = Object.assign({}, DEFAULTS);
    persist();
    document.dispatchEvent(new CustomEvent('settings:change', { detail: { reset: true } }));
  }
  return { load, persist, get, set, reset, DEFAULTS, KEY };
})();

const Formulas = (function(){
  const defs = [
    { id:'epley',    name:'Epley',    hardMax:12,
      fn:(w,r)=> r===1 ? w : w*(1+r/30),
      expr:(w,r)=> w+' × (1 + '+r+'/30)' },
    { id:'brzycki',  name:'Brzycki',  hardMax:10,
      fn:(w,r)=>{ if (r===1) return w; const d=37-r; return d<=0 ? NaN : (w*36)/d; },
      expr:(w,r)=> w+' × 36 / (37 − '+r+')' },
    { id:'lombardi', name:'Lombardi', hardMax:12,
      fn:(w,r)=> r===1 ? w : w*Math.pow(r,0.10),
      expr:(w,r)=> w+' × '+r+'^0.10' },
    { id:'lander',   name:'Lander',   hardMax:10,
      fn:(w,r)=>{ if (r===1) return w; const d=101.3-2.67123*r; return d<=0 ? NaN : (100*w)/d; },
      expr:(w,r)=> '100 × '+w+' / (101.3 − 2.67123 × '+r+')' },
    { id:'mayhew',   name:'Mayhew',   hardMax:12,
      fn:(w,r)=> r===1 ? w : (100*w)/(52.2+41.9*Math.exp(-0.055*r)),
      expr:(w,r)=> '100 × '+w+' / (52.2 + 41.9 × e^(−0.055 × '+r+'))' },
    { id:'oconner',  name:"O'Conner", hardMax:12,
      fn:(w,r)=> r===1 ? w : w*(1+r/40),
      expr:(w,r)=> w+' × (1 + '+r+'/40)' },
    { id:'wathan',   name:'Wathan',   hardMax:12,
      fn:(w,r)=> r===1 ? w : (100*w)/(48.8+53.8*Math.exp(-0.075*r)),
      expr:(w,r)=> '100 × '+w+' / (48.8 + 53.8 × e^(−0.075 × '+r+'))' }
  ];
  const byId = {};
  defs.forEach(d => byId[d.id] = d);

  function all(){ return defs.slice(); }
  function get(id){ return byId[id] || byId.epley; }
  function calc(id, weight, reps){
    if (!isFinite(weight) || weight <= 0) return NaN;
    if (!isFinite(reps) || reps < 1) return NaN;
    const f = get(id);
    if (reps > f.hardMax) return NaN;
    return safe(f.fn(weight, reps));
  }
  function ratio(id, reps){
    if (!isFinite(reps) || reps < 1) return NaN;
    const f = get(id);
    if (reps > f.hardMax) return NaN;
    return safe(f.fn(1, reps));
  }
  function repMax(id, oneRM, reps){
    if (!isFinite(oneRM) || oneRM <= 0) return NaN;
    const k = ratio(id, reps);
    if (!isFinite(k) || k === 0) return NaN;
    return safe(oneRM / k);
  }
  function percentForReps(id, reps){
    const k = ratio(id, reps);
    if (!isFinite(k) || k === 0) return NaN;
    return 100 / k;
  }
  function repsForPercent(id, pct){
    if (!isFinite(pct) || pct <= 0) return NaN;
    let best = 1, bestDiff = Infinity;
    for (let r = 1; r <= get(id).hardMax; r++){
      const p = percentForReps(id, r);
      if (!isFinite(p)) continue;
      const d = Math.abs(p - pct);
      if (d < bestDiff){ bestDiff = d; best = r; }
    }
    return best;
  }
  function explain(id, weight, reps){
    const f = get(id);
    const value = calc(id, weight, reps);
    if (!isFinite(value)) return f.name + ': cannot be computed at ' + reps + ' reps (exceeds the ' + f.hardMax + '-rep confidence limit for this formula).';
    return f.name + ': 1RM = ' + f.expr(weight, reps) + ' = ' + fmt(value);
  }
  function allEstimates(weight, reps){
    return defs.map(f => {
      const over = reps > f.hardMax;
      return {
        id: f.id, name: f.name,
        value: over ? NaN : calc(f.id, weight, reps),
        reliable: reps <= Math.min(f.hardMax, Settings.get('maxReps')),
        overCap: over
      };
    });
  }
  function consensus(weight, reps){
    const vals = allEstimates(weight, reps).map(r => r.value).filter(isFinite);
    if (!vals.length) return NaN;
    return vals.reduce((a,b)=>a+b,0) / vals.length;
  }
  function median(weight, reps){
    const vals = allEstimates(weight, reps).map(r => r.value).filter(isFinite).sort((a,b)=>a-b);
    if (!vals.length) return NaN;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid-1]+vals[mid])/2;
  }
  function populateSelect(selectEl, opts){
    const o = Object.assign({ consensus:true, value:'epley' }, opts || {});
    selectEl.innerHTML = '';
    if (o.consensus){
      const opt = document.createElement('option');
      opt.value = 'consensus';
      opt.textContent = 'Consensus (average of all formulas)';
      selectEl.appendChild(opt);
    }
    defs.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      selectEl.appendChild(opt);
    });
    if (o.value && Array.from(selectEl.options).some(op => op.value === o.value)) selectEl.value = o.value;
  }
  return { all, get, calc, ratio, repMax, percentForReps, repsForPercent,
           explain, allEstimates, consensus, median, populateSelect };
})();

// RPE / RIR — Tuchscherer / Helms chart, percentage of 1RM per (reps, RPE)
const RPE = (function(){
  const TABLE = {
    1:  { 10:1.000, 9.5:0.978, 9:0.955, 8.5:0.939, 8:0.925, 7.5:0.910, 7:0.895, 6.5:0.880, 6:0.865 },
    2:  { 10:0.955, 9.5:0.939, 9:0.922, 8.5:0.907, 8:0.892, 7.5:0.878, 7:0.863, 6.5:0.848, 6:0.833 },
    3:  { 10:0.922, 9.5:0.907, 9:0.892, 8.5:0.878, 8:0.863, 7.5:0.848, 7:0.833, 6.5:0.818, 6:0.803 },
    4:  { 10:0.892, 9.5:0.878, 9:0.863, 8.5:0.848, 8:0.833, 7.5:0.818, 7:0.803, 6.5:0.788, 6:0.773 },
    5:  { 10:0.863, 9.5:0.848, 9:0.833, 8.5:0.818, 8:0.803, 7.5:0.788, 7:0.773, 6.5:0.758, 6:0.743 },
    6:  { 10:0.833, 9.5:0.818, 9:0.803, 8.5:0.788, 8:0.773, 7.5:0.758, 7:0.743, 6.5:0.728, 6:0.713 },
    7:  { 10:0.803, 9.5:0.788, 9:0.773, 8.5:0.758, 8:0.743, 7.5:0.728, 7:0.713, 6.5:0.698, 6:0.683 },
    8:  { 10:0.773, 9.5:0.758, 9:0.743, 8.5:0.728, 8:0.713, 7.5:0.698, 7:0.683, 6.5:0.668, 6:0.653 },
    9:  { 10:0.743, 9.5:0.728, 9:0.713, 8.5:0.698, 8:0.683, 7.5:0.668, 7:0.653, 6.5:0.638, 6:0.623 },
    10: { 10:0.713, 9.5:0.698, 9:0.683, 8.5:0.668, 8:0.653, 7.5:0.638, 7:0.623, 6.5:0.608, 6:0.593 }
  };
  function percentFor(reps, rpe){
    const r = Math.max(1, Math.min(10, Math.round(reps)));
    const rp = Math.max(6, Math.min(10, rpe));
    const row = TABLE[r];
    if (!row) return NaN;
    let best = null, bestDiff = Infinity;
    Object.keys(row).forEach(k => {
      const d = Math.abs(parseFloat(k) - rp);
      if (d < bestDiff){ bestDiff = d; best = parseFloat(k); }
    });
    return row[best];
  }
  function e1rm(weight, reps, rpe){
    const p = percentFor(reps, rpe);
    if (!isFinite(p) || p <= 0) return NaN;
    return weight / p;
  }
  return { percentFor, e1rm };
})();

const Share = (function(){
  function baseUrl(){ return location.href.split('#')[0]; }
  function build(tabId, params){
    const usp = new URLSearchParams();
    usp.set('tab', tabId);
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
    });
    return baseUrl() + '#' + usp.toString();
  }
  function read(){
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return {};
    const usp = new URLSearchParams(raw);
    const out = {};
    usp.forEach((v, k) => { out[k] = v; });
    return out;
  }
  function replace(tabId, params){
    const url = build(tabId, params);
    try { history.replaceState(null, '', url); } catch (e){ /* file:// quirks */ }
  }
  return { build, read, replace };
})();

const Tables = (function(){
  function html(headers, rows, opts){
    const o = Object.assign({ className: 'data-table', id:null, rowClass: null }, opts || {});
    let h = '<table' + (o.id ? ' id="' + esc(o.id) + '"' : '') + ' class="' + o.className + '"><thead><tr>';
    h += headers.map(x => '<th>' + esc(x) + '</th>').join('');
    h += '</tr></thead><tbody>';
    for (let i = 0; i < rows.length; i++){
      const r = rows[i];
      let rowClass = '';
      if (typeof o.rowClass === 'function') rowClass = o.rowClass(r, i) || '';
      h += '<tr' + (rowClass ? ' class="' + esc(rowClass) + '"' : '') + '>';
      h += r.map(c => {
        if (c && typeof c === 'object' && !(c instanceof Date)){
          const display = (c.v === undefined ? '' : c.v);
          const raw = (c.raw === undefined ? display : c.raw);
          return '<td data-value="' + esc(String(raw)) + '">' + (c.html || esc(display)) + '</td>';
        }
        return '<td>' + (typeof c === 'string' && c.startsWith('<') ? c : esc(c === undefined || c === null ? '' : c)) + '</td>';
      }).join('');
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }
  function findTable(sel){
    if (!sel) return null;
    if (typeof sel === 'string'){
      const t = document.querySelector(sel);
      if (t && t.tagName === 'TABLE') return t;
      const wrap = document.querySelector(sel);
      if (wrap) {
        const inner = wrap.querySelector('table');
        if (inner) return inner;
      }
      const w2 = document.querySelector(sel + '-wrap');
      if (w2) {
        const inner = w2.querySelector('table');
        if (inner) return inner;
      }
      return null;
    }
    return sel;
  }
  function cellValue(cell){
    if (cell.dataset.value !== undefined) return cell.dataset.value;
    const field = cell.querySelector('input, select, textarea');
    if (field) return field.value;
    return cell.textContent.trim();
  }
  function rowsFrom(sel){
    const table = findTable(sel);
    if (!table) return [];
    return Array.from(table.querySelectorAll('tr')).map(tr =>
      Array.from(tr.querySelectorAll('th,td')).map(cellValue)
    );
  }
  function toCSV(rows){
    return rows.map(r => r.map(cellCSV).join(',')).join('\r\n');
  }
  function cellCSV(v){
    const s = String(v === undefined || v === null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function parseCSV(text){
    const rows = [];
    let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++){
      const c = text[i];
      if (inQ){
        if (c === '"'){
          if (text[i+1] === '"'){ field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ','){ cur.push(field); field = ''; }
        else if (c === '\n'){ cur.push(field); rows.push(cur); cur = []; field = ''; }
        else if (c === '\r'){ /* skip */ }
        else field += c;
      }
    }
    if (field !== '' || cur.length){ cur.push(field); rows.push(cur); }
    return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
  }
  return { html, rowsFrom, toCSV, parseCSV };
})();

const PlateMath = (function(){
  const DENOMINATIONS = {
    kg: [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25],
    lb: [45, 35, 25, 10, 5, 2.5, 1.25, 0.625]
  };
  const BARS = { kg: [20, 15, 10, 5], lb: [45, 35, 25, 15] };
  const DEFAULT_COUNTS = {
    kg: { 25:4, 20:4, 15:2, 10:4, 5:2, 2.5:2, 2:2, 1.5:2, 1:2, 0.5:2, 0.25:2 },
    lb: { 45:4, 35:2, 25:2, 10:4, 5:2, 2.5:2, 1.25:2, 0.625:2 }
  };
  const SCALE = 100;
  const MAX_TARGET_UNITS = 100000;

  function solvePerSide(targetPerSide, inventory){
    if (!isFinite(targetPerSide) || targetPerSide < 0) return null;
    const items = [];
    let total = 0;
    inventory.forEach(p => {
      const w = Math.round(p.w * SCALE);
      const n = Math.max(0, Math.floor(p.count || 0));
      if (w <= 0 || n === 0) return;
      for (let i = 0; i < n; i++){ items.push(w); total += w; }
    });

    let T = Math.round(targetPerSide * SCALE);
    if (T < 0) T = 0;
    if (T > MAX_TARGET_UNITS) return { outOfRange: true };
    if (T > total) T = total;

    const dp = new Int32Array(T + 1).fill(-1);
    dp[0] = -2;
    for (let i = 0; i < items.length; i++){
      const w = items[i];
      if (w > T) continue;
      for (let s = T; s >= w; s--){
        if (dp[s] === -1 && dp[s - w] !== -1) dp[s] = i;
      }
    }
    let best = -1;
    for (let s = T; s >= 0; s--){ if (dp[s] !== -1){ best = s; break; } }
    if (best < 0) return null;

    const used = [];
    let s = best, guard = 0;
    while (s > 0 && guard++ < 10000){
      const idx = dp[s];
      if (idx < 0) break;
      const w = items[idx];
      used.push(w);
      s -= w;
    }
    used.sort((a,b)=>b-a);
    return { perSide: best / SCALE, plates: used.map(x => x / SCALE) };
  }

  function solve(targetTotal, barWeight, inventory){
    if (!isFinite(targetTotal) || targetTotal < 0) return { achievable:false, reason:'invalid' };
    if (!isFinite(barWeight) || barWeight < 0) return { achievable:false, reason:'invalid' };
    if (targetTotal < barWeight) return { achievable:false, reason:'below-bar', perSide:0, plates:[], total:barWeight, barWeight };
    const perSideTarget = (targetTotal - barWeight) / 2;
    const sol = solvePerSide(perSideTarget, inventory);
    if (!sol) return { achievable:false, reason:'no-solution', perSide:0, plates:[], total:barWeight, barWeight };
    if (sol.outOfRange) return { achievable:false, reason:'out-of-range', perSide:0, plates:[], total:barWeight, barWeight };
    const total = barWeight + sol.perSide * 2;
    return {
      achievable: Math.abs(total - targetTotal) < 1e-6,
      exact: Math.abs(total - targetTotal) < 1e-6,
      shortfall: targetTotal - total,
      perSide: sol.perSide,
      plates: sol.plates,
      total: total,
      barWeight: barWeight,
      target: targetTotal
    };
  }
  function group(plates){
    const out = [];
    const seen = {};
    plates.forEach(p => {
      if (seen[p] === undefined){ seen[p] = out.length; out.push({ w: p, n: 0 }); }
      out[seen[p]].n++;
    });
    return out;
  }
  return { DENOMINATIONS, BARS, DEFAULT_COUNTS, solve, solvePerSide, group };
})();

const Scoring = (function(){
  const WILKS = {
    // wilks2 (2020), multiplier 600
    male:   { a:47.4617885411949, b:8.47206137941125, c:0.073694103462609, d:-0.00139583381094385, e:7.07665973070743e-06, f:-1.20804336482315e-08, min:40, max:200.95 },
    female: { a:-125.425539779509, b:13.7121941940668, c:-0.0330725063103405, d:-0.0010504000506583, e:9.38773881462799e-06, f:-2.3334613884954e-08, min:40, max:150.95 }
  };
  const DOTS = {
    male:   { a:-307.75076, b:24.0900756, c:-0.1918759221, d:0.0007391293, e:-0.000001093, min:40, max:210 },
    female: { a:-57.96288,  b:13.6175032, c:-0.1126655495, d:0.0005158568, e:-0.0000010706, min:40, max:150 }
  };
  const IPFGL = {
    classic_pl:  { male:{ A:1199.72839, B:1025.18162, C:0.00921 }, female:{ A:610.32796, B:1045.59282, C:0.03048 } },
    equipped_pl: { male:{ A:1236.25115, B:1449.21864, C:0.01644 }, female:{ A:758.63878, B:949.31382, C:0.02435 } },
    classic_bp:  { male:{ A:320.98041,  B:281.40258,  C:0.01008 }, female:{ A:142.40398, B:442.52671, C:0.04724 } },
    equipped_bp: { male:{ A:381.22073,  B:733.79378,  C:0.02398 }, female:{ A:221.82209, B:357.00377, C:0.02937 } }
  };
  function clampBw(x, k){ return Math.min(Math.max(x, k.min), k.max); }
  function currentEvent(){ const el = document.getElementById('sc-event'); return (el && IPFGL[el.value]) ? el.value : 'classic_pl'; }
  function wilks(totalKg, bwKg, sex){
    const k = WILKS[sex] || WILKS.male, x = clampBw(bwKg, k);
    const denom = k.a + k.b*x + k.c*x*x + k.d*Math.pow(x,3) + k.e*Math.pow(x,4) + k.f*Math.pow(x,5);
    if (!isFinite(denom) || denom <= 0) return { score: NaN, coeff: NaN, denom };
    const coeff = 600 / denom;
    return { score: safe(totalKg * coeff), coeff: safe(coeff), denom, clamped: x !== bwKg, xUsed: x };
  }
  function dots(totalKg, bwKg, sex){
    const k = DOTS[sex] || DOTS.male, x = clampBw(bwKg, k);
    const denom = k.a + k.b*x + k.c*x*x + k.d*Math.pow(x,3) + k.e*Math.pow(x,4);
    if (!isFinite(denom) || denom <= 0) return { score: NaN, coeff: NaN, denom };
    const coeff = 500 / denom;
    return { score: safe(totalKg * coeff), coeff: safe(coeff), denom, clamped: x !== bwKg, xUsed: x };
  }
  function ipfgl(totalKg, bwKg, sex){
    const ev = IPFGL[currentEvent()];
    const k = ev[sex] || ev.male;
    if (bwKg < 35) return { score: NaN, denom: NaN };
    const denom = k.A - k.B * Math.exp(-k.C * bwKg);
    if (!isFinite(denom) || denom <= 0) return { score: NaN, denom };
    return { score: safe(totalKg * 100 / denom), denom };
  }
  function compute(system, totalKg, bwKg, sex){
    if (!isFinite(totalKg) || !isFinite(bwKg) || bwKg <= 0) return { score: NaN };
    switch (system){
      case 'dots':  return Object.assign({ system:'DOTS' }, dots(totalKg, bwKg, sex));
      case 'ipfgl': return Object.assign({ system:'IPF GL' }, ipfgl(totalKg, bwKg, sex));
      default:      return Object.assign({ system:'Wilks' }, wilks(totalKg, bwKg, sex));
    }
  }
  function totalForScore(system, targetScore, bwKg, sex){
    if (!isFinite(targetScore) || targetScore <= 0) return NaN;
    let lo = 0, hi = 5000;
    for (let i = 0; i < 80; i++){
      const mid = (lo + hi) / 2;
      const s = compute(system, mid, bwKg, sex).score;
      if (!isFinite(s)) return NaN;
      if (s < targetScore) lo = mid; else hi = mid;
    }
    return safe((lo + hi) / 2);
  }
  return { compute, wilks, dots, ipfgl, totalForScore };
})();

const Standards = (function(){
  const KEY = 'orm_standards_v2';
  const LEVELS = ['Beginner','Novice','Intermediate','Advanced','Elite'];
  const DEFAULT_DATASET = {
    source: 'Approximate benchmark ratios compiled from commonly published strength-standard tables (ExRx-style and community strength-level charts).',
    methodology: 'Each level lists the upper-bound 1RM/bodyweight ratio. A lift is classified into the highest level whose threshold it meets. Ratios are independent of bodyweight (linear scaling), a simplification — absolute standards vary with body size and training age.',
    ratios: {
      male: {
        bench:    [0.50, 0.75, 1.00, 1.50, 2.00],
        squat:    [0.75, 1.00, 1.50, 2.00, 2.50],
        deadlift: [1.00, 1.25, 1.75, 2.50, 3.00],
        press:    [0.35, 0.50, 0.65, 0.85, 1.00],
        row:      [0.50, 0.65, 0.85, 1.10, 1.35]
      },
      female: {
        bench:    [0.25, 0.40, 0.60, 0.85, 1.15],
        squat:    [0.40, 0.65, 0.95, 1.35, 1.75],
        deadlift: [0.50, 0.80, 1.15, 1.60, 2.10],
        press:    [0.20, 0.30, 0.45, 0.60, 0.75],
        row:      [0.30, 0.45, 0.60, 0.80, 1.00]
      }
    }
  };
  let dataset = JSON.parse(JSON.stringify(DEFAULT_DATASET));

  function load(){
    try {
      const raw = localStorage.getItem(KEY);
      if (raw){
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ratios) dataset = parsed;
      }
    } catch (e){ StorageHealth.report(e); }
    return dataset;
  }
  function save(ds){
    dataset = ds;
    try { localStorage.setItem(KEY, JSON.stringify(ds)); StorageHealth.ok(); }
    catch (e){ StorageHealth.report(e); }
  }
  function reset(){
    dataset = JSON.parse(JSON.stringify(DEFAULT_DATASET));
    try { localStorage.removeItem(KEY); } catch (e){}
  }
  function get(){ return dataset; }
  function levels(){ return LEVELS.slice(); }
  function ratiosFor(ex, sex){
    const s = dataset.ratios[sex] || dataset.ratios.male;
    return s[ex] || null;
  }
  function classify(ratio, ex, sex){
    const r = ratiosFor(ex, sex);
    if (!r) return -1;
    for (let i = 0; i < r.length; i++) if (ratio < r[i]) return i;
    return r.length - 1;
  }
  return { load, save, reset, get, levels, ratiosFor, classify, DEFAULT_DATASET, KEY };
})();

const Tracker = (function(){
  const KEY = 'orm_history_v2';
  const OLD_KEY = 'orm_history_v1';
  let records = [];

  function migrate(raw){
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (raw && raw.v === 2 && Array.isArray(raw.records)) return raw.records;
    return [];
  }
  function load(){
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw){
        const old = localStorage.getItem(OLD_KEY);
        if (old){
          raw = { v: 2, records: JSON.parse(old) };
          try { localStorage.setItem(KEY, JSON.stringify(raw)); } catch (e){}
        }
      }
    } catch (e){ StorageHealth.report(e); }
    records = migrate(raw).map(r => ({
      id: r.id || uid(),
      date: validISO(r.date) ? r.date : '',
      exercise: String(r.exercise || '').trim(),
      weight: Number(r.weight) || 0,
      reps: Math.max(1, Math.min(36, parseInt(r.reps, 10) || 1)),
      unit: (r.unit === 'lb' ? 'lb' : 'kg'),
      notes: String(r.notes || '')
    })).filter(r => r.date && r.exercise && r.weight > 0);
    persist();
    return records;
  }
  function persist(){
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, records: records }));
      StorageHealth.ok();
      return true;
    } catch (e){
      StorageHealth.report(e);
      return false;
    }
  }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function add(rec){
    if (!validISO(rec.date)) return null;
    const r = Object.assign({ id: uid(), unit:'kg', notes:'' }, rec);
    r.exercise = String(r.exercise || '').trim();
    r.weight = Number(r.weight);
    r.reps = parseInt(r.reps, 10);
    if (!r.exercise || !isFinite(r.weight) || r.weight <= 0 || !isFinite(r.reps) || r.reps < 1) return null;
    records.push(r);
    persist();
    return r;
  }
  function update(id, patch){
    const r = records.find(x => x.id === id);
    if (!r) return null;
    if (patch.date !== undefined && !validISO(patch.date)) return null;
    Object.assign(r, patch);
    persist();
    return r;
  }
  function remove(id){
    records = records.filter(r => r.id !== id);
    persist();
  }
  function clearAll(){
    records = [];
    try { localStorage.removeItem(KEY); } catch (e){}
  }
  function all(){ return records.slice(); }
  function get(id){ return records.find(r => r.id === id); }
  function personalRecords(){
    const map = {};
    // Map common exercise-name spellings onto the canonical keys that
    // Badges / program generators / meet-day look up (bench, squat,
    // deadlift, press, row). Unknown names keep their raw lowercase key,
    // and the best e1RM wins when several spellings are logged.
    const PR_ALIASES = {
      'bench':'bench','bench press':'bench','bp':'bench','close grip bench':'bench','close grip bench press':'bench','pause bench':'bench','pause bench press':'bench','competition bench':'bench','competition bench press':'bench','comp bench':'bench','tng bench press':'bench',
      'squat':'squat','back squat':'squat','low bar squat':'squat','high bar squat':'squat','competition squat':'squat','comp squat':'squat','pause squat':'squat',
      'deadlift':'deadlift','dead lift':'deadlift','dead-lift':'deadlift','conventional deadlift':'deadlift','sumo deadlift':'deadlift','competition deadlift':'deadlift','comp deadlift':'deadlift',
      'press':'press','overhead press':'press','ohp':'press','military press':'press','standing press':'press','standing overhead press':'press','strict press':'press','barbell overhead press':'press',
      'row':'row','barbell row':'row','bent over row':'row','bent-over row':'row','pendlay row':'row'
    };
    records.forEach(r => {
      const kg = Units.toKg(r.weight, r.unit || 'kg');
      const e = Formulas.calc('epley', kg, Math.min(r.reps, Formulas.get('epley').hardMax));
      if (!isFinite(e)) return;
      const raw = (r.exercise || '').trim().toLowerCase();
      if (!raw) return;
      const key = PR_ALIASES[raw] || raw;
      if (!map[key] || e > map[key].e1rmKg){
        map[key] = { exercise: r.exercise, e1rmKg: e, record: r };
      }
    });
    return map;
  }
  return { load, persist, add, update, remove, clearAll, all, get, personalRecords, KEY };
})();

const Chart = (function(){
  function line(points, opts){
    const o = Object.assign({ width:620, height:220, label:'' }, opts || {});
    points = (points || []).filter(p => p && p.x instanceof Date && !isNaN(p.x.getTime()) && isFinite(p.y));
    if (points.length < 2) return '<p class="muted">Not enough data points for a chart.</p>';
    const w = o.width, h = o.height, pad = 42;
    const xs = points.map(p => p.x.getTime());
    const ys = points.map(p => p.y);
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const spanX = (maxX - minX) || 1;
    const spanY = (maxY - minY) || 1;
    const sx = v => pad + ((v - minX) / spanX) * (w - pad*2);
    const sy = v => (h - pad) - ((v - minY) / spanY) * (h - pad*2);
    const path = points.map((p,i) => (i?'L':'M') + sx(p.x.getTime()).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ');
    const dots = points.map(p =>
      '<circle cx="'+sx(p.x.getTime()).toFixed(1)+'" cy="'+sy(p.y).toFixed(1)+'" r="3" fill="#a83b1e"><title>'+esc(p.label||'')+'</title></circle>'
    ).join('');
    const gridLines = [0,0.25,0.5,0.75,1].map(t => {
      const y = pad + t * (h - pad*2);
      const val = maxY - t * spanY;
      return '<line x1="'+pad+'" y1="'+y.toFixed(1)+'" x2="'+(w-pad)+'" y2="'+y.toFixed(1)+'" stroke="#d8d2c6" stroke-width="1"/>' +
             '<text x="4" y="'+(y+4).toFixed(1)+'" font-size="10" fill="#6e665c">'+esc(val.toFixed(1))+'</text>';
    }).join('');
    return '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" role="img" aria-label="'+esc(o.label||'Progress chart')+'">' +
      gridLines + '<path d="'+path+'" fill="none" stroke="#a83b1e" stroke-width="2"/>' + dots + '</svg>';
  }
  function linearFit(points){
    const pts = points.filter(p => p && p.x instanceof Date && !isNaN(p.x.getTime()) && isFinite(p.y));
    if (pts.length < 3) return null;
    const x0 = pts[0].x.getTime();
    const n = pts.length;
    let sx=0, sy=0, sxy=0, sxx=0;
    pts.forEach(p => {
      const x = (p.x.getTime() - x0) / 86400000;
      sx += x; sy += p.y; sxy += x*p.y; sxx += x*x;
    });
    const denom = n*sxx - sx*sx;
    if (!isFinite(denom) || denom === 0) return null;
    const slope = (n*sxy - sx*sy) / denom;
    const intercept = (sy - slope*sx) / n;
    return { slope, intercept, x0 };
  }
  return { line, linearFit };
})();

const Tabs = (function(){
  const buttons = $$('.tab-btn');
  const panels = $$('.tab-panel');
  let current = '1rm';
  function show(id, opts){
    if (!panels.some(p => p.id === 'panel-' + id)) id = '1rm';
    current = id;
    buttons.forEach(b => {
      const on = b.dataset.tab === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(p => { p.hidden = p.id !== 'panel-' + id; });
    if (!opts || !opts.silent){
      const params = Share.read();
      delete params.tab;
      Share.replace(id, params);
    }
    document.dispatchEvent(new CustomEvent('tab:change', { detail: { id } }));
  }
  function init(){
    buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    const hash = Share.read();
    if (hash.tab) show(hash.tab, { silent: true });
    else show('1rm', { silent: true });
  }
  function get(){ return current; }
  return { init, show, get };
})();

const Renderers = [];
function registerRenderer(fn){ Renderers.push(fn); }
function renderAll(){
  Renderers.forEach(fn => { try { fn(); } catch (e){ console.error('Render error:', e); } });
}

const UnitConverters = [];
function registerUnitConverter(fn){ UnitConverters.push(fn); }
function runUnitConverters(oldUnit, newUnit){
  UnitConverters.forEach(fn => { try { fn(oldUnit, newUnit); } catch (e){ console.error('Unit converter error:', e); } });
}

function roundingOptions(){
  return Settings.get('unit') === 'kg' ? [0.25, 0.5, 1, 1.25, 2, 2.5, 5] : [0.5, 1, 2.5, 5, 10];
}
function fillRoundingSelect(selectEl, value){
  const unit = Settings.get('unit');
  const opts = roundingOptions();
  selectEl.innerHTML = '';
  opts.forEach(v => {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = v + ' ' + unit;
    selectEl.appendChild(o);
  });
  const want = value !== undefined ? value : Settings.get('rounding');
  const match = opts.find(v => Math.abs(v - want) < 1e-9);
  selectEl.value = String(match !== undefined ? match : (opts.indexOf(2.5) >= 0 ? 2.5 : opts[0]));
}

(function markWeightInputs(){
  const ids = [
    '#orm-weight','#orm-bw','#rm-1rm','#rm-src-weight','#pc-1rm','#tm-1rm','#pl-target','#wu-base',
    '#sc-bw','#sc-squat','#sc-bench','#sc-dead','#sc-total',
    '#st-bw','#st-lift','#br-bw','#br-lift',
    '#im-squat','#im-bench','#im-dead','#im-press','#im-row',
    '#pg-squat','#pg-bench','#pg-dead','#pg-press',
    '#tk-weight','#at-squat','#at-bench','#at-dead','#at-target-total',
    '#cmp-a-squat','#cmp-a-bench','#cmp-a-dead','#cmp-a-bw',
    '#cmp-b-squat','#cmp-b-bench','#cmp-b-dead','#cmp-b-bw'
  ];
  ids.forEach(id => {
    const el = document.querySelector(id);
    if (el) el.setAttribute('data-weight','');
  });
})();

function convertWeightInputs(oldUnit, newUnit){
  if (oldUnit === newUnit) return;
  document.querySelectorAll('input[data-weight]').forEach(el => {
    const v = parseFloat(el.value);
    if (!isFinite(v)) return;
    const conv = Units.convert(v, oldUnit, newUnit);
    if (isFinite(conv)) el.value = String(roundDp(conv, 1));
  });
}

const ShareCard = (function(){
  function wrapText(ctx, text, x, y, maxWidth, lineHeight){
    const words = String(text).split(/\s+/);
    let line = '', lines = [];
    for (let i = 0; i < words.length; i++){
      const test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line){
        lines.push(line); line = words[i];
      } else line = test;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i*lineHeight));
    return lines.length;
  }
  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }
  async function create(opts){
    const W = 1080, H = 1350;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c1a17';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#a83b1e';
    ctx.fillRect(0, 0, W, 10);
    ctx.fillStyle = '#a49d92';
    ctx.font = '600 30px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(opts.title || '').toUpperCase(), 80, 150);
    if (opts.category){
      ctx.fillStyle = '#a83b1e';
      roundRect(ctx, 80, 190, ctx.measureText(opts.category).width + 40, 50, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(opts.category, 100, 224);
    }
    ctx.fillStyle = '#f0ebe3';
    ctx.font = '700 180px Georgia, "Iowan Old Style", serif';
    ctx.fillText(String(opts.hero || ''), 80, 430);
    if (opts.unit){
      ctx.fillStyle = '#a83b1e';
      ctx.font = '600 70px Georgia, serif';
      const heroW = ctx.measureText(String(opts.hero || '')).width;
      ctx.fillText(opts.unit, 80 + heroW + 40, 430);
    }
    if (opts.subtitle){
      ctx.fillStyle = '#a49d92';
      ctx.font = '500 38px system-ui, sans-serif';
      wrapText(ctx, opts.subtitle, 80, 520, W - 160, 52);
    }
    if (opts.rows && opts.rows.length){
      let y = 720;
      ctx.font = '500 34px system-ui, sans-serif';
      opts.rows.forEach(row => {
        ctx.fillStyle = '#8a8378';
        ctx.fillText(row[0], 80, y);
        ctx.fillStyle = '#f0ebe3';
        const val = String(row[1]);
        const w = ctx.measureText(val).width;
        ctx.fillText(val, W - 80 - w, y);
        ctx.strokeStyle = '#3c3934';
        ctx.beginPath();
        ctx.moveTo(80, y + 24);
        ctx.lineTo(W - 80, y + 24);
        ctx.stroke();
        y += 76;
      });
    }
    ctx.fillStyle = '#8a8378';
    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillText('One Rep Max & Strength Calculators — no account needed', 80, H - 80);
    ctx.fillStyle = '#a83b1e';
    ctx.fillRect(0, H - 10, W, 10);
    return new Promise(resolve => c.toBlob(resolve, 'image/png'));
  }
  async function present(opts){
    const blob = await create(opts);
    const filename = 'onerepmax-' + (opts.filename || 'card') + '.png';
    const shared = await shareBlob(blob, filename, opts.shareText || opts.title || '', opts.title || 'One Rep Max');
    toast(shared ? 'Shared' : 'Card downloaded');
  }
  return { create, present };
})();

// Minimal PDF writer — Helvetica base fonts, no external library
const PDFExport = (function(){
  function escPdf(s){
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  function build(lines){
    const W = 595, H = 842, margin = 50;
    let content = 'BT\n';
    let y = H - margin;
    lines.forEach(line => {
      const text = escPdf(line.text);
      const size = line.size || 11;
      const font = line.bold ? 'F2' : 'F1';
      content += '/' + font + ' ' + size + ' Tf\n';
      content += '1 0 0 1 ' + margin + ' ' + y.toFixed(1) + ' Tm\n';
      content += '(' + text + ') Tj\n';
      y -= (size + 6);
    });
    content += 'ET\n';

    const objects = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>');
    objects.push('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, i) => {
      offsets.push(pdf.length);
      pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
    });
    const xrefStart = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++){
      pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n';
    pdf += 'startxref\n' + xrefStart + '\n%%EOF';
    return pdf;
  }
  function download(filename, lines){
    const text = build(lines);
    const blob = new Blob([text], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { build, download };
})();

const Archetype = (function(){
  const EXPECTED = {
    'bench:squat':  { lo:0.55, hi:0.85, mid:0.70, label:'Bench : Squat' },
    'dead:squat':   { lo:1.05, hi:1.35, mid:1.20, label:'Deadlift : Squat' },
    'press:bench':  { lo:0.45, hi:0.75, mid:0.60, label:'OHP : Bench' },
    'row:bench':    { lo:0.55, hi:0.90, mid:0.72, label:'Row : Bench' }
  };
  function analyze(inputs){
    const have = {};
    Object.keys(inputs).forEach(k => { if (isFinite(inputs[k]) && inputs[k] > 0) have[k] = inputs[k]; });
    const ratios = {};
    Object.keys(EXPECTED).forEach(key => {
      const parts = key.split(':');
      const a = parts[0], b = parts[1];
      if (have[a] && have[b]) ratios[key] = have[a] / have[b];
    });
    let archetype = 'Balanced Lifter', tag = 'No dominant lift yet.';
    if (have.squat && have.dead && have.bench){
      const bs = have.bench / have.squat;
      const ds = have.dead / have.squat;
      const sd = have.squat / have.dead;
      if (bs > 0.85) { archetype = 'Bench-Forward'; tag = 'Your pressing is ahead of your squat pattern.'; }
      else if (ds > 1.35) { archetype = 'Posterior Chain Specialist'; tag = 'Deadlift-dominant — you pull more than you squat.'; }
      else if (sd > 1.25) { archetype = 'Squat-Dominant'; tag = 'Your squat is ahead of your pull.'; }
      else if (Math.abs(bs - 0.70) < 0.08 && Math.abs(ds - 1.20) < 0.10){ archetype = 'All-Rounder'; tag = 'Ratios sit close to the common benchmarks.'; }
    }
    const meters = Object.keys(EXPECTED).map(key => {
      const e = EXPECTED[key];
      const r = ratios[key];
      if (!isFinite(r)) return { label:e.label, value:null, expected:e.mid, text:'—', level:'ok' };
      let level = 'ok', text = 'within range';
      if (r < e.lo){ level = 'warn'; text = 'below typical range'; }
      if (r > e.hi){ level = 'warn'; text = 'above typical range'; }
      if (r < e.lo * 0.85 || r > e.hi * 1.15){ level = 'bad'; text = 'noticeably off typical'; }
      return { label:e.label, value:r, expected:e.mid, lo:e.lo, hi:e.hi, text, level };
    });
    return { archetype, tag, ratios, meters };
  }
  return { analyze };
})();

const Badges = (function(){
  const LIST = [
    { id:'bw_bench',  name:'Bodyweight Bench',  desc:'Bench 1× bodyweight',             check: (prs, bw) => prs.bench && bw && prs.bench.e1rmKg >= bw },
    { id:'bw_squat',  name:'1.5× BW Squat',     desc:'Squat 1.5× bodyweight',           check: (prs, bw) => prs.squat && bw && prs.squat.e1rmKg >= bw*1.5 },
    { id:'bw_dl',     name:'2× BW Deadlift',    desc:'Deadlift 2× bodyweight',          check: (prs, bw) => prs.deadlift && bw && prs.deadlift.e1rmKg >= bw*2 },
    { id:'two_plate', name:'Two-Plate Club',    desc:'20 kg / 45 lb plate per side on any lift', check: (prs) => anyLiftAtLeast(prs, 60) },
    { id:'three_plate', name:'Three-Plate Club',desc:'30 kg / 60 lb per side on any lift', check: (prs) => anyLiftAtLeast(prs, 100) },
    { id:'four_plate',  name:'Four-Plate Club', desc:'40 kg / 90 lb per side on any lift', check: (prs) => anyLiftAtLeast(prs, 140) },
    { id:'club_500kg',  name:'500 kg Total',    desc:'Squat + Bench + Deadlift ≥ 500 kg', check: (prs) => totalKg(prs) >= 500 },
    { id:'club_1000lb', name:'1000 lb Total',   desc:'Squat + Bench + Deadlift ≥ 1000 lb', check: (prs) => totalKg(prs) / Units.KG_PER_LB >= 1000 },
    { id:'triple_bw',   name:'Triple-Bodyweight Total', desc:'Total ≥ 3× bodyweight',    check: (prs, bw) => bw && totalKg(prs) >= bw*3 },
    { id:'press_bw',    name:'Bodyweight Press', desc:'Overhead press 1× bodyweight',   check: (prs, bw) => prs.press && bw && prs.press.e1rmKg >= bw },
    { id:'row_bench',   name:'Row ≥ Bench',     desc:'Row a weight at least equal to your bench', check: (prs) => prs.row && prs.bench && prs.row.e1rmKg >= prs.bench.e1rmKg },
    { id:'total_400',   name:'400 kg Total',    desc:'Total ≥ 400 kg',                  check: (prs) => totalKg(prs) >= 400 }
  ];
  function anyLiftAtLeast(prs, kg){
    return ['bench','squat','deadlift','press','row'].some(k => prs[k] && prs[k].e1rmKg >= kg);
  }
  function totalKg(prs){
    return ['bench','squat','deadlift'].reduce((s,k) => s + (prs[k] ? prs[k].e1rmKg : 0), 0);
  }
  function evaluate(prs, bwKg){
    return LIST.map(b => Object.assign({}, b, { unlocked: !!b.check(prs, bwKg) }));
  }
  return { LIST, evaluate, anyLiftAtLeast, totalKg };
})();

const Animals = (function(){
  const TABLE = [
    { kg:0.5,   name:'a house cat' },
    { kg:2,     name:'a bottle of wine' },
    { kg:4,     name:'a gallon of paint' },
    { kg:8,     name:'a cinder block' },
    { kg:15,    name:'a car tire' },
    { kg:25,    name:'a golden retriever' },
    { kg:40,    name:'a bag of cement' },
    { kg:60,    name:'an average adult human' },
    { kg:90,    name:'a washing machine' },
    { kg:140,   name:'a vending machine' },
    { kg:200,   name:'a small motorcycle' },
    { kg:300,   name:'a grand piano' },
    { kg:450,   name:'a full-grown grizzly bear' },
    { kg:700,   name:'a small car' },
    { kg:1200,  name:'a compact SUV' }
  ];
  function nearest(kg){
    if (!isFinite(kg) || kg <= 0) return null;
    let best = TABLE[0], bestDelta = Math.abs(TABLE[0].kg - kg);
    for (let i = 1; i < TABLE.length; i++){
      const d = Math.abs(TABLE[i].kg - kg);
      if (d < bestDelta){ best = TABLE[i]; bestDelta = d; }
    }
    return best;
  }
  function phrase(kg){
    const n = nearest(kg);
    if (!n) return '';
    return 'That\'s roughly ' + n.name + ' (' + n.kg + ' kg).';
  }
  return { nearest, phrase, TABLE };
})();

const Programs = (function(){
  function wAdd(tm, add, inc){
    return (tm > 0) ? roundTo(tm + add, inc) : '—';
  }
  function wPct(tm, pct, add, inc){
    if (!(tm > 0)) return '—';
    return roundTo(tm * pct + (add || 0), inc);
  }

  function lp(tms, weeks, unit){
    const inc = unit === 'kg' ? 2.5 : 5;
    const bigInc = unit === 'kg' ? 5 : 10;
    const out = [];
    for (let w = 0; w < weeks; w++){
      out.push({
        label: 'Week ' + (w+1),
        days: [
          { name:'A', sets:[
            { exercise:'Squat',         reps:'5', sets:'3', weight: wAdd(tms.squat, w*bigInc, inc) },
            { exercise:'Bench Press',   reps:'5', sets:'3', weight: wAdd(tms.bench, w*inc,   inc) },
            { exercise:'Deadlift',      reps:'5', sets:'1', weight: wAdd(tms.dead,  w*bigInc, inc) }
          ]},
          { name:'B', sets:[
            { exercise:'Squat',         reps:'5', sets:'3', weight: wAdd(tms.squat, w*bigInc, inc) },
            { exercise:'Overhead Press',reps:'5', sets:'3', weight: wAdd(tms.press, w*inc,   inc) },
            { exercise:'Deadlift',      reps:'5', sets:'1', weight: wAdd(tms.dead,  w*bigInc, inc) }
          ]}
        ]
      });
    }
    return out;
  }

  function fiveThreeOne(tms, weeks, unit){
    const inc = unit === 'kg' ? 2.5 : 5;
    const out = [];
    for (let w = 0; w < weeks; w++){
      const phase = w % 4;
      let plan;
      if (phase === 3) plan = [[40,5],[50,5],[60,5]];
      else {
        plan = [[65,5],[75,5],[85,5]];
        if (phase === 1) plan = [[70,3],[80,3],[90,3]];
        if (phase === 2) plan = [[75,5],[85,3],[95,1]];
      }
      const days = [
        { name:'Squat',          sets: plan.map(p => ({ exercise:'Squat',          reps:String(p[1]), sets:'1', weight: wPct(tms.squat, p[0]/100, 0, inc) })) },
        { name:'Bench Press',    sets: plan.map(p => ({ exercise:'Bench Press',    reps:String(p[1]), sets:'1', weight: wPct(tms.bench, p[0]/100, 0, inc) })) },
        { name:'Deadlift',       sets: plan.map(p => ({ exercise:'Deadlift',       reps:String(p[1]), sets:'1', weight: wPct(tms.dead,  p[0]/100, 0, inc) })) },
        { name:'Overhead Press', sets: plan.map(p => ({ exercise:'Overhead Press', reps:String(p[1]), sets:'1', weight: wPct(tms.press, p[0]/100, 0, inc) })) }
      ];
      out.push({ label: 'Week ' + (w+1) + (phase === 3 ? ' (deload)' : ''), days });
    }
    return out;
  }

  function gzclp(tms, weeks, unit){
    const inc = unit === 'kg' ? 2.5 : 5;
    const out = [];
    for (let w = 0; w < weeks; w++){
      const bump = w * inc;
      out.push({
        label: 'Week ' + (w+1),
        days: [
          { name:'Day 1 — T1 Squat / T2 Bench / T3 Lat', sets:[
            { exercise:'Squat (T1)',  reps:'5×3 → 6×2 → 10×1', sets:'3–10', weight: wAdd(tms.squat, bump, inc) },
            { exercise:'Bench (T2)',  reps:'3×10',              sets:'3',    weight: wPct(tms.bench, 0.75, bump, inc) },
            { exercise:'Lat Pulldown',reps:'3×15',              sets:'3',    weight:'—' }
          ]},
          { name:'Day 2 — T1 OHP / T2 Deadlift / T3 Row', sets:[
            { exercise:'OHP (T1)',     reps:'5×3 → 6×2 → 10×1', sets:'3–10', weight: wAdd(tms.press, bump, inc) },
            { exercise:'Deadlift (T2)',reps:'3×10',             sets:'3',    weight: wPct(tms.dead,  0.75, bump, inc) },
            { exercise:'Row (T3)',     reps:'3×15',             sets:'3',    weight:'—' }
          ]},
          { name:'Day 3 — T1 Bench / T2 Squat / T3 Curl', sets:[
            { exercise:'Bench (T1)',  reps:'5×3 → 6×2 → 10×1', sets:'3–10', weight: wAdd(tms.bench, bump, inc) },
            { exercise:'Squat (T2)',  reps:'3×10',              sets:'3',    weight: wPct(tms.squat, 0.75, bump, inc) },
            { exercise:'Curl (T3)',   reps:'3×15',              sets:'3',    weight:'—' }
          ]},
          { name:'Day 4 — T1 Deadlift / T2 OHP / T3 Row', sets:[
            { exercise:'Deadlift (T1)',reps:'5×3 → 6×2 → 10×1', sets:'3–10', weight: wAdd(tms.dead, bump, inc) },
            { exercise:'OHP (T2)',     reps:'3×10',             sets:'3',    weight: wPct(tms.press, 0.75, bump, inc) },
            { exercise:'Row (T3)',     reps:'3×15',             sets:'3',    weight:'—' }
          ]}
        ]
      });
    }
    return out;
  }

  function phul(tms, weeks, unit){
    const inc = unit === 'kg' ? 2.5 : 5;
    const out = [];
    for (let w = 0; w < weeks; w++){
      const bump = w * inc;
      out.push({
        label: 'Week ' + (w+1),
        days: [
          { name:'Upper Power', sets:[
            { exercise:'Bench Press',    reps:'3–5',  sets:'4', weight: wPct(tms.bench, 0.85, bump, inc) },
            { exercise:'Row',            reps:'3–5',  sets:'4', weight: wPct(tms.bench, 0.70, bump, inc) },
            { exercise:'Overhead Press', reps:'5–8',  sets:'3', weight: wPct(tms.press, 0.80, bump, inc) },
            { exercise:'Curl',           reps:'6–10', sets:'3', weight:'—' }
          ]},
          { name:'Lower Power', sets:[
            { exercise:'Squat',          reps:'3–5',  sets:'4', weight: wPct(tms.squat, 0.85, bump, inc) },
            { exercise:'Deadlift',       reps:'3–5',  sets:'3', weight: wPct(tms.dead,  0.85, bump, inc) },
            { exercise:'Leg Press',      reps:'8–10', sets:'3', weight:'—' },
            { exercise:'Calf Raise',     reps:'10–15',sets:'4', weight:'—' }
          ]},
          { name:'Upper Hypertrophy', sets:[
            { exercise:'Bench Press',    reps:'8–12', sets:'4', weight: wPct(tms.bench, 0.65, 0, inc) },
            { exercise:'Row',            reps:'8–12', sets:'4', weight: wPct(tms.bench, 0.55, 0, inc) },
            { exercise:'Overhead Press', reps:'8–12', sets:'3', weight: wPct(tms.press, 0.65, 0, inc) },
            { exercise:'Curl',           reps:'10–15',sets:'3', weight:'—' }
          ]},
          { name:'Lower Hypertrophy', sets:[
            { exercise:'Squat',          reps:'8–12', sets:'4', weight: wPct(tms.squat, 0.65, 0, inc) },
            { exercise:'Deadlift',       reps:'8–12', sets:'3', weight: wPct(tms.dead,  0.60, 0, inc) },
            { exercise:'Leg Press',      reps:'10–15',sets:'4', weight:'—' },
            { exercise:'Calf Raise',     reps:'12–20',sets:'4', weight:'—' }
          ]}
        ]
      });
    }
    return out;
  }

  function generate(style, tms, weeks, unit){
    switch (style){
      case '531':   return fiveThreeOne(tms, weeks, unit);
      case 'gzclp': return gzclp(tms, weeks, unit);
      case 'phul':  return phul(tms, weeks, unit);
      default:      return lp(tms, weeks, unit);
    }
  }
  return { generate, wAdd, wPct };
})();

const Panel1RM = (function(){
  const EX_NAMES = {
    bench:'Bench Press', squat:'Back Squat', front_squat:'Front Squat',
    deadlift:'Deadlift', sumo_deadlift:'Sumo Deadlift', rdl:'Romanian Deadlift',
    press:'Overhead Press', push_press:'Push Press', row:'Barbell Row',
    pendlay_row:'Pendlay Row', curl:'Barbell Curl',
    db_bench:'Dumbbell Bench Press', db_incline:'Dumbbell Incline Bench',
    db_press:'Dumbbell Shoulder Press', db_row:'Dumbbell Row', db_curl:'Dumbbell Curl',
    pullups:'Weighted Pull-Ups', chin_ups:'Weighted Chin-Ups', dips:'Weighted Dips',
    legpress:'Leg Press', hack_squat:'Hack Squat', smith_bench:'Smith Machine Bench',
    lat_pulldown:'Lat Pulldown', cable_row:'Cable Row'
  };
  const BW_LIFTS = ['pullups','chin_ups','dips'];
  const DB_LIFTS = ['db_bench','db_incline','db_press','db_row','db_curl'];

  function exerciseName(){
    const v = $('#orm-exercise').value;
    if (v === 'custom') return $('#orm-custom').value.trim() || 'Custom Exercise';
    return EX_NAMES[v] || 'Exercise';
  }
  function currentInputs(){
    return {
      exercise: $('#orm-exercise').value,
      custom: $('#orm-custom').value,
      loadtype: $('#orm-loadtype').value,
      bw: $('#orm-bw').value,
      weight: $('#orm-weight').value,
      reps: $('#orm-reps').value,
      rpeOn: $('#orm-rpe-toggle').checked ? '1' : '',
      rpe: $('#orm-rpe').value,
      formula: $('#orm-formula').value
    };
  }
  function resolveWeight(){
    const ex = $('#orm-exercise').value;
    const lt = $('#orm-loadtype').value;
    const w = parseFloat($('#orm-weight').value);
    if (!isFinite(w) || w < 0) return NaN;
    if (BW_LIFTS.indexOf(ex) >= 0){
      const bw = parseFloat($('#orm-bw').value);
      if (!isFinite(bw) || bw <= 0) return NaN;
      return bw + w;
    }
    if (lt === 'per_hand') return w * 2;
    return w;
  }
  function updateLoadUI(){
    const ex = $('#orm-exercise').value;
    const isBW = BW_LIFTS.indexOf(ex) >= 0;
    const isDB = DB_LIFTS.indexOf(ex) >= 0;

    $('#orm-custom-wrap').classList.toggle('hidden', ex !== 'custom');
    $('#orm-bw-wrap').classList.toggle('hidden', !isBW);

    const ltSel = $('#orm-loadtype');
    if (isBW){
      ltSel.innerHTML = '<option value="barbell">Added load on top of bodyweight</option>';
      ltSel.value = 'barbell';
    } else if (isDB){
      ltSel.innerHTML =
        '<option value="per_hand">Dumbbell — weight per hand</option>' +
        '<option value="barbell">Dumbbell — total load (both hands)</option>';
      if (ltSel.value !== 'per_hand' && ltSel.value !== 'barbell') ltSel.value = 'per_hand';
    } else {
      ltSel.innerHTML = '<option value="barbell">Barbell — total weight on the bar</option>';
      ltSel.value = 'barbell';
    }
  }
  function render(){
    const unit = Settings.get('unit');
    updateLoadUI();

    const wRes = readNum($('#orm-weight'), { min: 0, max: 5000, label: 'Weight' });
    const rRes = readNum($('#orm-reps'), { min: 1, max: 36, label: 'Repetitions', integer: true });
    const errEl = $('#orm-error');

    if (!wRes.ok || !rRes.ok){
      errEl.textContent = !wRes.ok ? wRes.msg : rRes.msg;
      $('#orm-result').textContent = '—';
      $('#orm-result-label').textContent = '';
      $('#orm-breakdown').textContent = '';
      $('#orm-table-wrap').innerHTML = '';
      return;
    }
    errEl.textContent = '';

    const effective = resolveWeight();
    if (!isFinite(effective) || effective <= 0){
      errEl.textContent = 'Enter a valid weight' + (BW_LIFTS.indexOf($('#orm-exercise').value) >= 0 ? ' and bodyweight.' : '.');
      $('#orm-result').textContent = '—';
      return;
    }

    const r = rRes.value;
    const rpeOn = $('#orm-rpe-toggle').checked;
    const rpeVal = parseFloat($('#orm-rpe').value);
    const selected = $('#orm-formula').value;

    const estimates = Formulas.allEstimates(effective, r);
    const consensus = Formulas.consensus(effective, r);
    const med = Formulas.median(effective, r);

    let mainValue, mainLabel;
    if (rpeOn && isFinite(rpeVal)){
      const pctOfRm = RPE.percentFor(r, rpeVal);
      mainValue = isFinite(pctOfRm) && pctOfRm > 0 ? effective / pctOfRm : NaN;
      mainLabel = 'RPE ' + rpeVal + ' (' + r + ' reps, ' + (10 - rpeVal) + ' in reserve) · ' + Math.round(pctOfRm * 100) + '% of 1RM';
    } else if (selected === 'consensus'){
      mainValue = consensus;
      mainLabel = 'Consensus (mean of ' + estimates.filter(e => isFinite(e.value)).length + ' formulas)';
    } else {
      const f = Formulas.get(selected);
      mainValue = Formulas.calc(selected, effective, r);
      mainLabel = f.name + ' estimate';
    }

    const ex = $('#orm-exercise').value;
    const lt = $('#orm-loadtype').value;
    let setupNote = '';
    if (BW_LIFTS.indexOf(ex) >= 0){
      setupNote = ' (bodyweight ' + fmt(parseFloat($('#orm-bw').value), 1) + ' + ' + fmt(wRes.value, 1) + ' added = ' + fmt(effective, 1) + ' ' + unit + ' total)';
    } else if (DB_LIFTS.indexOf(ex) >= 0 && lt === 'per_hand'){
      setupNote = ' (per-hand ' + fmt(wRes.value, 1) + ' × 2 = ' + fmt(effective, 1) + ' ' + unit + ' total)';
    }

    $('#orm-result').textContent = isFinite(mainValue) ? fmt(mainValue) + ' ' + unit : '—';
    $('#orm-result-label').textContent =
      exerciseName() + ' — ' + fmt(wRes.value, 2) + ' ' + unit + ' × ' + r + ' rep' + (r===1?'':'s') + setupNote + ' · ' + mainLabel;

    let bd = '';
    bd += 'Exercise:      ' + exerciseName() + '\n';
    bd += 'Set performed: ' + fmt(wRes.value, 2) + ' ' + unit + ' × ' + r + ' rep' + (r===1?'':'s') + '\n';
    if (setupNote) bd += 'Total load:    ' + fmt(effective, 2) + ' ' + unit + '\n';
    if (rpeOn){
      const pctOfRm = RPE.percentFor(r, rpeVal);
      bd += '\nRPE method (Tuchscherer / Helms RIR model)\n';
      bd += '  RPE ' + rpeVal + ' → ' + (10 - rpeVal) + ' rep(s) in reserve\n';
      bd += '  Implied % of 1RM = ' + (isFinite(pctOfRm) ? fmt(pctOfRm * 100, 1) + '%' : 'n/a') + '\n';
      bd += '  Result: ' + (isFinite(mainValue) ? fmt(mainValue) + ' ' + unit : 'n/a');
    } else if (selected === 'consensus'){
      bd += '\nConsensus = mean of valid formula results\n';
      estimates.forEach(e => {
        bd += '  ' + pad(e.name, 12) + ' ' +
          (isFinite(e.value) ? fmt(e.value) + ' ' + unit : (e.overCap ? '(exceeds ' + Formulas.get(e.id).hardMax + '-rep cap)' : 'n/a')) + '\n';
      });
      bd += '  ' + pad('Median', 12) + ' ' + (isFinite(med) ? fmt(med) + ' ' + unit : 'n/a') + '\n';
      bd += '\nResult: ' + (isFinite(consensus) ? fmt(consensus) + ' ' + unit : 'n/a');
    } else {
      bd += '\n' + Formulas.explain(selected, effective, r) + '\n';
      const pctOfRm = Formulas.percentForReps(selected, r);
      bd += 'Percentage of 1RM used: ' + (isFinite(pctOfRm) ? fmt(pctOfRm, 1) + '%' : 'n/a') + '\n';
      bd += 'Result: ' + (isFinite(mainValue) ? fmt(mainValue) + ' ' + unit : 'n/a');
    }
    if (r > Settings.get('maxReps')){
      bd += '\n\n' + r + ' reps exceeds your reliability limit (' + Settings.get('maxReps') + '). Treat this estimate with caution.';
    }
    $('#orm-breakdown').textContent = bd;

    const rows = estimates.map(e => [
      e.name,
      { v: isFinite(e.value) ? fmt(e.value, 2) : (e.overCap ? '— (over cap)' : '—'),
        raw: isFinite(e.value) ? e.value.toFixed(2) : '' },
      e.reliable ? 'Yes' : (e.overCap ? 'Exceeds formula cap' : 'Low confidence'),
      isFinite(e.value) && effective > 0 ? fmt(e.value / effective, 3) + '×' : '—'
    ]);
    rows.push([
      'Consensus (mean)',
      { v: isFinite(consensus) ? fmt(consensus, 2) : '—', raw: isFinite(consensus) ? consensus.toFixed(2) : '' },
      '—', isFinite(consensus) && effective > 0 ? fmt(consensus / effective, 3) + '×' : '—'
    ]);
    $('#orm-table-wrap').innerHTML = Tables.html(
      ['Formula', 'Estimated 1RM (' + unit + ')', 'Reliability', '× body of set'], rows
    );
  }
  function pad(s, n){ s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); }
  function syncUrl(){ Share.replace('1rm', currentInputs()); }
  let syncTimer = null;
  function scheduleSync(){ clearTimeout(syncTimer); syncTimer = setTimeout(syncUrl, 250); }

  function init(){
    Formulas.populateSelect($('#orm-formula'), { consensus:true, value: Settings.get('formula') });
    ['#orm-weight', '#orm-reps', '#orm-custom', '#orm-bw'].forEach(s => {
      $(s).addEventListener('input', () => { render(); scheduleSync(); });
    });
    $('#orm-exercise').addEventListener('change', () => { render(); syncUrl(); });
    $('#orm-loadtype').addEventListener('change', () => { render(); syncUrl(); });
    $('#orm-formula').addEventListener('change', () => { render(); syncUrl(); });
    $('#orm-rpe-toggle').addEventListener('change', () => {
      $('#orm-rpe-wrap').classList.toggle('hidden', !$('#orm-rpe-toggle').checked);
      render();
    });
    $('#orm-rpe').addEventListener('change', render);
    $('#orm-reset').addEventListener('click', () => {
      $('#orm-weight').value = '100'; $('#orm-reps').value = '5'; $('#orm-bw').value = '80';
      $('#orm-exercise').value = 'bench'; $('#orm-custom').value = '';
      $('#orm-rpe-toggle').checked = false; $('#orm-rpe-wrap').classList.add('hidden');
      render(); syncUrl(); toast('Reset');
    });
    $('#orm-share').addEventListener('click', async () => {
      const url = Share.build('1rm', currentInputs());
      const ok = await copyText(url);
      toast(ok ? 'Shareable link copied' : 'Copy failed: ' + url);
    });
    $('#orm-print').addEventListener('click', () => window.print());
    $('#orm-pdf').addEventListener('click', () => {
      const effective = resolveWeight();
      const r = parseInt($('#orm-reps').value, 10);
      if (!isFinite(effective) || effective <= 0 || !isFinite(r) || r < 1){
        $('#orm-error').textContent = 'Enter a valid weight and reps before exporting.';
        return;
      }
      const unit = Settings.get('unit');
      const selected = $('#orm-formula').value;
      const rpeOn = $('#orm-rpe-toggle').checked;
      const rpeVal = parseFloat($('#orm-rpe').value);
      let result, method;
      if (rpeOn && isFinite(rpeVal)){
        const pctOfRm = RPE.percentFor(r, rpeVal);
        result = isFinite(pctOfRm) && pctOfRm > 0 ? effective / pctOfRm : NaN;
        method = 'RPE ' + rpeVal + ' (' + (10 - rpeVal) + ' in reserve)';
      } else if (selected === 'consensus'){
        result = Formulas.consensus(effective, r);
        method = 'Consensus (mean of all formulas)';
      } else {
        result = Formulas.calc(selected, effective, r);
        method = Formulas.get(selected).name;
      }
      if (!isFinite(result)){ toast('No result to export'); return; }

      const lines = [];
      lines.push({ text: 'One Rep Max Report', size: 20, bold: true });
      lines.push({ text: '', size: 8 });
      lines.push({ text: 'Exercise: ' + exerciseName(), size: 12 });
      lines.push({ text: 'Units: ' + unit, size: 12 });
      lines.push({ text: 'Set: ' + fmt(parseFloat($('#orm-weight').value), 2) + ' ' + unit + ' x ' + r + ' reps', size: 12 });
      if (BW_LIFTS.indexOf($('#orm-exercise').value) >= 0){
        lines.push({ text: 'Bodyweight: ' + fmt(parseFloat($('#orm-bw').value), 1) + ' ' + unit, size: 12 });
      }
      lines.push({ text: '', size: 8 });
      lines.push({ text: 'Estimated 1RM: ' + fmt(result, 2) + ' ' + unit, size: 16, bold: true });
      lines.push({ text: 'Method: ' + method, size: 12 });
      lines.push({ text: '', size: 8 });
      lines.push({ text: 'Training percentages', size: 14, bold: true });
      [60, 65, 70, 75, 80, 85, 90, 95].forEach(p => {
        lines.push({ text: p + '%  -  ' + fmt(result * p / 100, 2) + ' ' + unit, size: 12 });
      });
      lines.push({ text: '', size: 8 });
      lines.push({ text: 'All formula estimates', size: 14, bold: true });
      Formulas.allEstimates(effective, r).forEach(e => {
        if (isFinite(e.value)){
          lines.push({ text: e.name + ': ' + fmt(e.value, 2) + ' ' + unit, size: 12 });
        }
      });
      lines.push({ text: '', size: 8 });
      lines.push({ text: 'Estimates only. Verify with a spotter and proper form before testing a true max.', size: 10 });

      PDFExport.download('one-rep-max-' + $('#orm-exercise').value + '.pdf', lines);
      toast('PDF exported');
    });
    $('#orm-share-card').addEventListener('click', async () => {
      const wRes = readNum($('#orm-weight'), { min: 0, max: 5000, label:'Weight' });
      const rRes = readNum($('#orm-reps'), { min:1, max:36, label:'Reps', integer:true });
      if (!wRes.ok || !rRes.ok){ $('#orm-error').textContent = !wRes.ok ? wRes.msg : rRes.msg; return; }
      const effective = resolveWeight();
      if (!isFinite(effective)){ toast('No result to share'); return; }
      const sel = $('#orm-formula').value;
      const val = sel === 'consensus' ? Formulas.consensus(effective, rRes.value) : Formulas.calc(sel, effective, rRes.value);
      if (!isFinite(val)){ toast('No result to share'); return; }
      const unit = Settings.get('unit');
      const label = sel === 'consensus' ? 'Consensus 1RM' : Formulas.get(sel).name + ' 1RM';
      await ShareCard.present({
        title: exerciseName(),
        category: label,
        hero: fmt(val, 1),
        unit: unit,
        subtitle: 'Estimated from ' + fmt(wRes.value, 1) + ' ' + unit + ' × ' + rRes.value + ' rep' + (rRes.value === 1 ? '' : 's'),
        rows: [
          ['Set performed', fmt(wRes.value, 1) + ' ' + unit + ' × ' + rRes.value],
          ['Formula', sel === 'consensus' ? 'Consensus (mean)' : Formulas.get(sel).name],
          ['Estimate', fmt(val, 2) + ' ' + unit]
        ],
        filename: 'orm-' + sel
      });
    });
    render();
  }
  function fromUrl(params){
    if (params.w !== undefined) $('#orm-weight').value = params.w;
    if (params.r !== undefined) $('#orm-reps').value = params.r;
    if (params.e !== undefined && $('#orm-exercise').querySelector('option[value="' + params.e + '"]')) $('#orm-exercise').value = params.e;
    if (params.c !== undefined) $('#orm-custom').value = params.c;
    if (params.lt !== undefined && $('#orm-loadtype').querySelector('option[value="' + params.lt + '"]')) $('#orm-loadtype').value = params.lt;
    if (params.bw !== undefined) $('#orm-bw').value = params.bw;
    if (params.rpeOn === '1'){ $('#orm-rpe-toggle').checked = true; $('#orm-rpe-wrap').classList.remove('hidden'); }
    if (params.rpe !== undefined) $('#orm-rpe').value = params.rpe;
    if (params.f !== undefined && $('#orm-formula').querySelector('option[value="' + params.f + '"]')) $('#orm-formula').value = params.f;
    render();
  }
  registerRenderer(render);
  return { init, render, fromUrl };
})();

const PanelRepMax = (function(){
  function render(){
    const unit = Settings.get('unit');
    const oneRM = readNum($('#rm-1rm'), { min:0.01, max:5000, label:'One rep max' });
    const minR = readNum($('#rm-min'), { min:1, max:36, label:'Minimum reps', integer:true });
    const maxR = readNum($('#rm-max'), { min:1, max:36, label:'Maximum reps', integer:true });
    const errEl = $('#rm-error');
    if (!oneRM.ok || !minR.ok || !maxR.ok){
      errEl.textContent = !oneRM.ok ? oneRM.msg : (!minR.ok ? minR.msg : maxR.msg);
      $('#rm-table-wrap').innerHTML = ''; $('#rm-summary').textContent = '';
      return;
    }
    if (minR.value > maxR.value){ errEl.textContent = 'Minimum reps cannot exceed maximum.'; $('#rm-table-wrap').innerHTML=''; return; }
    if (maxR.value - minR.value > 60){ errEl.textContent = 'Please choose a range of 60 reps or fewer.'; return; }
    errEl.textContent = '';

    const id = $('#rm-formula').value;
    const compare = $('#rm-compare').checked;
    const formulas = Formulas.all();
    const headers = ['Reps'];
    if (compare){ formulas.forEach(f => headers.push(f.name)); headers.push('Consensus'); }
    else { headers.push('Weight (' + unit + ')', '% of 1RM', 'Est. reps at this %'); }

    const rows = [];
    for (let r = minR.value; r <= maxR.value; r++){
      if (compare){
        const row = [r];
        formulas.forEach(f => {
          const v = Formulas.repMax(f.id, oneRM.value, r);
          row.push({ v: isFinite(v) ? fmt(v, 2) : '—', raw: isFinite(v) ? v.toFixed(2) : '' });
        });
        const vals = formulas.map(f => Formulas.repMax(f.id, oneRM.value, r)).filter(isFinite);
        const cons = vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : NaN;
        row.push({ v: isFinite(cons) ? fmt(cons, 2) : '—', raw: isFinite(cons) ? cons.toFixed(2) : '' });
        rows.push(row);
      } else {
        const v = Formulas.repMax(id, oneRM.value, r);
        const pct = Formulas.percentForReps(id, r);
        rows.push([
          r,
          { v: isFinite(v) ? fmt(v, 2) : '—', raw: isFinite(v) ? v.toFixed(2) : '' },
          { v: isFinite(pct) ? fmt(pct, 1) + '%' : '—', raw: isFinite(pct) ? pct.toFixed(1) : '' },
          r <= Settings.get('maxReps') ? 'reliable range' : 'low confidence'
        ]);
      }
    }
    $('#rm-table-wrap').innerHTML = Tables.html(headers, rows);
    const f = Formulas.get(id);
    $('#rm-summary').textContent =
      'Based on 1RM ' + fmt(oneRM.value, 2) + ' ' + unit + ' using ' +
      (compare ? 'all formulas side by side' : 'the ' + f.name + ' formula') +
      '. Rows above ' + Settings.get('maxReps') + ' reps are less reliable.';
  }
  function init(){
    Formulas.populateSelect($('#rm-formula'), { consensus:false, value: Settings.get('formula') });
    ['#rm-1rm','#rm-min','#rm-max'].forEach(s => $(s).addEventListener('input', render));
    $('#rm-formula').addEventListener('change', render);
    $('#rm-compare').addEventListener('change', render);
    $('#rm-use-estimate').addEventListener('click', () => {
      const w = readNum($('#rm-src-weight'), { min:0.01, max:5000, label:'Weight' });
      const r = readNum($('#rm-src-reps'), { min:1, max:36, label:'Reps', integer:true });
      if (!w.ok || !r.ok){ $('#rm-error').textContent = !w.ok ? w.msg : r.msg; return; }
      const cons = Formulas.consensus(w.value, r.value);
      if (!isFinite(cons)){ $('#rm-error').textContent = 'Could not estimate a 1RM from those inputs.'; return; }
      $('#rm-1rm').value = roundDp(cons, 2);
      render(); toast('1RM estimated from set');
    });
    $('#rm-print').addEventListener('click', () => window.print());
    $('#rm-share-card').addEventListener('click', async () => {
      const oneRM = readNum($('#rm-1rm'), { min:0.01, max:5000, label:'One rep max' });
      if (!oneRM.ok){ $('#rm-error').textContent = oneRM.msg; return; }
      const unit = Settings.get('unit');
      const id = $('#rm-formula').value;
      const rows = [1,3,5,8,10,12].filter(r => r <= Formulas.get(id).hardMax).map(r => {
        const v = Formulas.repMax(id, oneRM.value, r);
        return [r + ' rep' + (r===1?'':'s'), isFinite(v) ? fmt(v, 1) + ' ' + unit : '—'];
      });
      await ShareCard.present({
        title: Formulas.get(id).name + ' Rep Maxes',
        category: 'Rep Max Table',
        hero: fmt(oneRM.value, 0),
        unit: unit,
        subtitle: 'Estimated working weights based on a ' + fmt(oneRM.value, 1) + ' ' + unit + ' 1RM',
        rows: rows,
        filename: 'rep-max'
      });
    });
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelPercent = (function(){
  const STEP = 5;
  let built = false;
  function buildCheckboxes(){
    const host = $('#pc-checkboxes'); host.innerHTML = '';
    for (let p = 50; p <= 100; p += STEP){
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = String(p); cb.checked = true;
      cb.addEventListener('change', render);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(p + '%'));
      host.appendChild(label);
    }
    built = true;
  }
  function selectedPercentages(){
    const out = [];
    $$('#pc-checkboxes input[type=checkbox]').forEach(cb => { if (cb.checked) out.push(Number(cb.value)); });
    const custom = $('#pc-custom').value.split(',');
    custom.forEach(part => {
      const t = part.trim();
      if (!t || !NUMERIC_RE.test(t)) return;
      const v = Number(t);
      if (isFinite(v) && v > 0) out.push(v);
    });
    return Array.from(new Set(out)).sort((a,b)=>a-b);
  }
  function render(){
    if (!built) buildCheckboxes();
    const unit = Settings.get('unit');
    const oneRM = readNum($('#pc-1rm'), { min:0.01, max:5000, label:'One rep max' });
    const inc = Number($('#pc-round').value) || 0;
    const errEl = $('#pc-error');
    if (!oneRM.ok){ errEl.textContent = oneRM.msg; $('#pc-table-wrap').innerHTML=''; $('#pc-summary').textContent=''; return; }
    errEl.textContent = '';

    const pcts = selectedPercentages();
    if (!pcts.length){ errEl.textContent = 'Select at least one percentage.'; $('#pc-table-wrap').innerHTML=''; return; }

    const formulaId = $('#pc-formula').value;
    let hasOver = false;
    const rows = pcts.map(p => {
      const raw = oneRM.value * p / 100;
      const rounded = roundTo(raw, inc);
      const reps = Formulas.repsForPercent(formulaId, p);
      if (p > 100) hasOver = true;
      return [
        { v: p + '%', raw: p },
        { v: isFinite(rounded) ? fmt(rounded, 2) : '—', raw: isFinite(rounded) ? rounded.toFixed(2) : '' },
        { v: isFinite(raw) ? fmt(raw, 2) : '—', raw: isFinite(raw) ? raw.toFixed(2) : '' },
        !isFinite(reps) ? '—'
          : (reps === Formulas.get(formulaId).hardMax && p < Formulas.percentForReps(formulaId, reps))
            ? reps + '+ reps'
            : '~' + reps + ' rep' + (reps === 1 ? '' : 's')
      ];
    });
    $('#pc-table-wrap').innerHTML = Tables.html(
      ['% of 1RM', 'Working weight (' + unit + ')', 'Unrounded (' + unit + ')', 'Est. reps'], rows
    );
    $('#pc-summary').textContent =
      'Based on 1RM ' + fmt(oneRM.value, 2) + ' ' + unit + ', rounded to nearest ' + inc + ' ' + unit +
      '. Rep estimates use ' + Formulas.get(formulaId).name + '.';
    if (hasOver) {
      $('#pc-summary').textContent += ' Percentages above 100% are above a true 1RM and not a normal training prescription.';
      $('#pc-summary').className = 'warn';
    } else {
      $('#pc-summary').className = 'muted';
    }
  }
  function init(){
    Formulas.populateSelect($('#pc-formula'), { consensus:false, value: Settings.get('formula') });
    fillRoundingSelect($('#pc-round'), Settings.get('rounding'));
    ['#pc-1rm','#pc-custom'].forEach(s => $(s).addEventListener('input', render));
    $('#pc-formula').addEventListener('change', render);
    $('#pc-round').addEventListener('change', render);
    $('#pc-print').addEventListener('click', () => window.print());
    $('#pc-share-card').addEventListener('click', async () => {
      const oneRM = readNum($('#pc-1rm'), { min:0.01, max:5000, label:'One rep max' });
      if (!oneRM.ok){ $('#pc-error').textContent = oneRM.msg; return; }
      const unit = Settings.get('unit');
      const inc = Number($('#pc-round').value) || 0;
      const rows = [60,70,75,80,85,90].map(p => [p + '% of 1RM', fmt(roundTo(oneRM.value*p/100, inc), 1) + ' ' + unit]);
      await ShareCard.present({
        title: 'Percentage Table',
        category: 'Working Weights',
        hero: fmt(oneRM.value, 0),
        unit: unit,
        subtitle: 'Working weights derived from a ' + fmt(oneRM.value, 1) + ' ' + unit + ' 1RM',
        rows: rows,
        filename: 'percent-table'
      });
    });
    render();
  }
  registerRenderer(() => { if (built) render(); });
  return { init, render };
})();

const PanelTM = (function(){
  function render(){
    const unit = Settings.get('unit');
    const oneRM = readNum($('#tm-1rm'), { min:0.01, max:5000, label:'One rep max' });
    const pct = readNum($('#tm-pct'), { min:10, max:100, label:'Training max percentage' });
    const inc = Number($('#tm-round').value) || 0;
    const errEl = $('#tm-error');
    if (!oneRM.ok || !pct.ok){
      errEl.textContent = !oneRM.ok ? oneRM.msg : pct.msg;
      $('#tm-result').textContent = '—'; $('#tm-summary').textContent = ''; $('#tm-diff').textContent = ''; $('#tm-table-wrap').innerHTML = '';
      return;
    }
    errEl.textContent = '';
    const tmRaw = oneRM.value * pct.value / 100;
    const tm = roundTo(tmRaw, inc);
    const diff = oneRM.value - tm;
    $('#tm-result').textContent = fmt(tm, 2) + ' ' + unit;
    $('#tm-summary').textContent =
      ($('#tm-source').value === 'tested' ? 'Tested' : 'Estimated') + ' 1RM ' + fmt(oneRM.value, 2) + ' ' + unit +
      ' × ' + fmt(pct.value, 1) + '% = ' + fmt(tm, 2) + ' ' + unit + ' training max.';
    $('#tm-diff').textContent =
      'One rep max:   ' + fmt(oneRM.value, 2) + ' ' + unit + '\n' +
      'Training max:  ' + fmt(tm, 2) + ' ' + unit + '\n' +
      'Difference:    ' + fmt(diff, 2) + ' ' + unit + ' (' + fmt(oneRM.value > 0 ? diff/oneRM.value*100 : 0, 1) + '% below 1RM)\n' +
      'Unrounded TM:  ' + fmt(tmRaw, 3) + ' ' + unit;

    const listRaw = $('#tm-work').value.split(',');
    const list = [];
    let over100 = false;
    listRaw.forEach(p => {
      const t = p.trim();
      if (!t || !NUMERIC_RE.test(t)) return;
      const v = Number(t);
      if (isFinite(v) && v > 0 && v <= 150){ list.push(v); if (v > 100) over100 = true; }
    });
    list.sort((a,b)=>a-b);
    if (!list.length){ errEl.textContent = 'Enter at least one working percentage.'; $('#tm-table-wrap').innerHTML=''; return; }

    const rows = list.map(p => {
      const raw = tm * p / 100;
      const rounded = roundTo(raw, inc);
      return [
        { v: p + '%', raw: p },
        { v: isFinite(rounded) ? fmt(rounded, 2) : '—', raw: isFinite(rounded) ? rounded.toFixed(2) : '' },
        { v: isFinite(raw) ? fmt(raw, 2) : '—', raw: isFinite(raw) ? raw.toFixed(2) : '' },
        oneRM.value > 0 ? fmt(p / 100 * (tm / oneRM.value) * 100, 1) + '% of 1RM' : '—'
      ];
    });
    $('#tm-table-wrap').innerHTML = Tables.html(
      ['% of TM', 'Weight (' + unit + ')', 'Unrounded (' + unit + ')', 'Equivalent'], rows
    );
    if (over100) errEl.textContent = 'One or more working percentages exceed 100% of the training max.';
  }
  function init(){
    fillRoundingSelect($('#tm-round'), Settings.get('rounding'));
    ['#tm-1rm','#tm-pct','#tm-work'].forEach(s => $(s).addEventListener('input', render));
    $('#tm-round').addEventListener('change', render);
    $('#tm-source').addEventListener('change', render);
    $('#tm-print').addEventListener('click', () => window.print());
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelPlate = (function(){
  const INV_KEY = 'orm_inventory_v1';
  let inventories = null;
  let built = false;
  let buildingUnit = null;

  function loadInventory(){
    if (inventories) return inventories;
    inventories = { kg: null, lb: null };
    try {
      const raw = localStorage.getItem(INV_KEY);
      if (raw){
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object'){
          inventories.kg = parsed.kg || null;
          inventories.lb = parsed.lb || null;
        }
      }
    } catch (e){ StorageHealth.report(e); }
    return inventories;
  }
  function persistInventory(){
    if (!inventories) return;
    try { localStorage.setItem(INV_KEY, JSON.stringify(inventories)); StorageHealth.ok(); }
    catch (e){ StorageHealth.report(e); }
  }
  function ensureUnitInventory(unit){
    const inv = loadInventory();
    if (!inv[unit]){
      const counts = PlateMath.DEFAULT_COUNTS[unit];
      const map = {};
      PlateMath.DENOMINATIONS[unit].forEach(w => { map[w] = counts[w] !== undefined ? counts[w] : 0; });
      inv[unit] = map;
      persistInventory();
    }
    return inv[unit];
  }
  function buildInventoryUI(force){
    const unit = Settings.get('unit');
    if (!force && built && buildingUnit === unit) return;
    buildingUnit = unit;
    const host = $('#pl-inventory');
    const inv = ensureUnitInventory(unit);
    host.innerHTML = '';
    PlateMath.DENOMINATIONS[unit].forEach(w => {
      const label = document.createElement('label');
      label.textContent = w + ' ' + unit;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0'; input.max = '50'; input.step = '1';
      input.value = String(inv[w] !== undefined ? inv[w] : 0);
      input.dataset.plate = String(w);
      input.dataset.unit = unit;
      input.addEventListener('input', () => {
        let n = parseInt(input.value, 10);
        if (!isFinite(n) || n < 0) n = 0;
        inv[w] = n;
        persistInventory();
        render();
      });
      label.appendChild(input);
      host.appendChild(label);
    });
    built = true;
  }
  function buildBarUI(){
    const unit = Settings.get('unit');
    const sel = $('#pl-bar');
    const expected = PlateMath.BARS[unit].map(String).concat(['0']);
    const actual = Array.from(sel.options).map(o => o.value);
    if (JSON.stringify(expected) === JSON.stringify(actual)) return;
    const prev = sel.value;
    sel.innerHTML = '';
    PlateMath.BARS[unit].forEach(w => {
      const o = document.createElement('option');
      o.value = String(w);
      o.textContent = w + ' ' + unit;
      sel.appendChild(o);
    });
    const o = document.createElement('option');
    o.value = '0';
    o.textContent = '0 ' + unit + ' (no bar)';
    sel.appendChild(o);
    if (prev && Array.from(sel.options).some(x => x.value === prev)) sel.value = prev;
  }
  function readInventory(){
    const unit = Settings.get('unit');
    const inv = ensureUnitInventory(unit);
    return PlateMath.DENOMINATIONS[unit].map(w => ({ w: w, count: inv[w] || 0 }));
  }

  function render(){
    const unit = Settings.get('unit');
    if (!built || buildingUnit !== unit) buildInventoryUI(true);
    buildBarUI();

    const target = readNum($('#pl-target'), { min:0, max:5000, label:'Target weight' });
    const errEl = $('#pl-error');
    const warn = $('#pl-warning');
    warn.innerHTML = '';

    if (!target.ok){
      errEl.textContent = target.msg;
      $('#pl-result').textContent = '—'; $('#pl-summary').textContent = '';
      $('#pl-diagram').innerHTML = ''; $('#pl-table-wrap').innerHTML = '';
      return;
    }
    const bar = Number($('#pl-bar').value) || 0;
    const inventory = readInventory();
    const sol = PlateMath.solve(target.value, bar, inventory);

    if (sol.reason === 'below-bar'){
      errEl.textContent = 'Target is below bar weight (' + fmt(bar, 2) + ' ' + unit + ').';
      $('#pl-result').textContent = '—'; $('#pl-summary').textContent = '';
      $('#pl-diagram').innerHTML = ''; $('#pl-table-wrap').innerHTML = '';
      return;
    }
    if (sol.reason === 'out-of-range'){
      errEl.textContent = 'Target exceeds the supported range for plate solving.';
      return;
    }
    if (sol.reason === 'no-solution'){
      errEl.textContent = 'No plate solution could be built from the current inventory.';
      return;
    }
    errEl.textContent = '';

    $('#pl-result').textContent = fmt(sol.total, 2) + ' ' + unit;
    $('#pl-summary').textContent =
      'Target ' + fmt(target.value, 2) + ' ' + unit + ' · Bar ' + fmt(bar, 2) + ' ' + unit +
      ' · Per side ' + fmt(sol.perSide, 2) + ' ' + unit;

    const grouped = PlateMath.group(sol.plates);
    const plateRows = grouped.map(g => [
      { v: g.w + ' ' + unit, raw: g.w },
      { v: String(g.n), raw: g.n },
      { v: fmt(g.w * g.n, 2), raw: (g.w*g.n).toFixed(2) },
      { v: fmt(g.w * g.n * 2, 2), raw: (g.w*g.n*2).toFixed(2) }
    ]);
    plateRows.push(['Total per side', String(sol.plates.length), fmt(sol.perSide, 2), fmt(sol.perSide * 2, 2)]);
    $('#pl-table-wrap').innerHTML = Tables.html(
      ['Plate (' + unit + ')', 'Count per side', 'Weight per side', 'Both sides'], plateRows
    );

    $('#pl-diagram').innerHTML = diagramSVG(sol.plates, unit);

    if (sol.exact){
      warn.className = 'ok';
      warn.textContent = 'Exact load achievable with the current inventory.';
    } else {
      warn.className = 'warn';
      warn.textContent = 'Exact load is not possible. Closest achievable load (never above target): ' +
        fmt(sol.total, 2) + ' ' + unit + ' — ' + fmt(sol.shortfall, 2) + ' ' + unit + ' below target.';
    }
  }

  function diagramSVG(plates, unit){
    if (!plates || !plates.length) return '<p class="muted">No plates loaded — bar only.</p>';
    const maxW = Math.max.apply(null, plates);
    const colors = ['#a03a2a','#3a352e','#5a6a7a','#4a6b5a','#a08040','#5a4a6a','#5a5a5a'];
    const denomList = PlateMath.DENOMINATIONS[unit];
    let html = '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<div style="display:flex;align-items:center;gap:2px;">';
    for (let i = 0; i < plates.length; i++) html += plateDiv(plates[i], maxW, denomList, colors);
    html += '</div>';
    html += '<div style="height:12px;width:90px;background:#8a8378;border-radius:2px;"></div>';
    html += '<div style="display:flex;align-items:center;gap:2px;flex-direction:row-reverse;">';
    for (let i = 0; i < plates.length; i++) html += plateDiv(plates[i], maxW, denomList, colors);
    html += '</div></div>';
    return html;
  }
  function plateDiv(w, maxW, denomList, colors){
    const rel = maxW > 0 ? w / maxW : 1;
    const height = Math.round(46 + rel * 74);
    const idx = denomList.indexOf(w);
    const color = colors[(idx >= 0 ? idx : 3) % colors.length];
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
      '<div class="plate" style="height:' + height + 'px;background:' + color + ';"></div>' +
      '<div style="font-size:9px;color:#6e665c;margin-top:2px;">' + esc(w) + '</div></div>';
  }

  function init(){
    loadInventory();
    buildInventoryUI(true);
    buildBarUI();
    $('#pl-target').addEventListener('input', render);
    $('#pl-bar').addEventListener('change', render);
    $('#pl-reset-inv').addEventListener('click', () => {
      const unit = Settings.get('unit');
      const counts = PlateMath.DEFAULT_COUNTS[unit];
      const map = {};
      PlateMath.DENOMINATIONS[unit].forEach(w => { map[w] = counts[w] !== undefined ? counts[w] : 0; });
      inventories[unit] = map;
      persistInventory();
      buildInventoryUI(true);
      render();
      toast('Inventory reset');
    });
    $('#pl-print').addEventListener('click', () => window.print());
    $('#pl-share-card').addEventListener('click', async () => {
      const target = readNum($('#pl-target'), { min:0, max:5000, label:'Target weight' });
      if (!target.ok){ $('#pl-error').textContent = target.msg; return; }
      const unit = Settings.get('unit');
      const bar = Number($('#pl-bar').value) || 0;
      const sol = PlateMath.solve(target.value, bar, readInventory());
      if (!sol || !isFinite(sol.total)){ toast('No solution to share'); return; }
      const grouped = PlateMath.group(sol.plates);
      const perSideText = grouped.length ? grouped.map(g => g.n + '×' + g.w).join(' + ') : 'bar only';
      await ShareCard.present({
        title: 'Plate Loading',
        category: sol.exact ? 'Exact Load' : 'Closest Load',
        hero: fmt(sol.total, 0),
        unit: unit,
        subtitle: 'Per side: ' + perSideText + ' · Bar ' + fmt(bar, 1) + ' ' + unit,
        rows: [
          ['Target', fmt(target.value, 2) + ' ' + unit],
          ['Achieved', fmt(sol.total, 2) + ' ' + unit],
          ['Per side', fmt(sol.perSide, 2) + ' ' + unit]
        ],
        filename: 'plate-load'
      });
    });
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelWarmup = (function(){
  let sets = [];
  function generate(){
    const base = readNum($('#wu-base'), { min:0.01, max:5000, label:'Base weight' });
    const n = readNum($('#wu-sets'), { min:1, max:12, label:'Number of sets', integer:true });
    const start = readNum($('#wu-start'), { min:5, max:95, label:'Start percentage' });
    const end = readNum($('#wu-end'), { min:10, max:100, label:'End percentage' });
    const rest = readNum($('#wu-rest'), { min:0, max:900, label:'Rest', integer:true });
    const errEl = $('#wu-error');
    if (!base.ok || !n.ok || !start.ok || !end.ok || !rest.ok){
      errEl.textContent = (!base.ok ? base.msg : !n.ok ? n.msg : !start.ok ? start.msg : !end.ok ? end.msg : rest.msg);
      return;
    }
    if (start.value >= end.value && n.value > 1){ errEl.textContent = 'Start percentage must be lower than end percentage.'; return; }
    errEl.textContent = '';

    const style = $('#wu-style').value;
    const working = $('#wu-basetype').value === '1rm' ? base.value * 0.9 : base.value;
    const inc = Number($('#wu-round').value) || 0;
    const count = n.value;
    const pctList = [];
    for (let i = 0; i < count; i++){
      const t = count === 1 ? end.value : i / (count - 1);
      pctList.push(start.value + (end.value - start.value) * t);
    }
    const plateAware = $('#wu-plateaware').checked;
    const unit = Settings.get('unit');
    const inv = (function(){
      try {
        const raw = localStorage.getItem('orm_inventory_v1');
        if (raw){
          const p = JSON.parse(raw);
          if (p && p[unit]) return p[unit];
        }
      } catch (e){}
      return Object.assign({}, PlateMath.DEFAULT_COUNTS[unit]);
    })();
    const bar = PlateMath.BARS[unit][0];
    sets = pctList.map(p => {
      let reps;
      if (style === 'pl'){
        reps = p < 50 ? 5 : p < 65 ? 5 : p < 80 ? 3 : p < 90 ? 2 : 1;
      } else {
        reps = p < 50 ? 8 : p < 65 ? 5 : p < 80 ? 3 : p < 90 ? 2 : 1;
      }
      let weight = roundTo(working * p / 100, inc);
      let snapped = false;
      if (plateAware && inv && isFinite(weight) && weight > bar){
        const invArr = PlateMath.DENOMINATIONS[unit].map(w => ({ w:w, count: inv[w] || 0 }));
        const sol = PlateMath.solve(weight, bar, invArr);
        if (sol && isFinite(sol.total) && sol.total > 0){
          if (Math.abs(sol.total - weight) > 1e-6) snapped = true;
          weight = sol.total;
        }
      }
      return { pct: roundDp(p, 1), weight: weight, reps: reps, rest: rest.value, working: working, snapped: snapped };
    });
    renderTable();
  }
  function renderTable(){
    const unit = Settings.get('unit');
    const working = sets.length ? sets[0].working : NaN;
    const rows = sets.map((s, i) => [
      'Set ' + (i + 1),
      { v: s.pct + '%', raw: s.pct },
      '<input type="number" class="wu-w" data-i="' + i + '" step="0.5" min="0" value="' + (isFinite(s.weight) ? s.weight : '') + '" style="width:90px;" aria-label="Set ' + (i+1) + ' weight">',
      '<input type="number" class="wu-r" data-i="' + i + '" step="1" min="1" max="50" value="' + s.reps + '" style="width:70px;" aria-label="Set ' + (i+1) + ' reps">',
      '<input type="number" class="wu-t" data-i="' + i + '" step="15" min="0" max="900" value="' + s.rest + '" style="width:80px;" aria-label="Set ' + (i+1) + ' rest">'
    ]);
    $('#wu-table-wrap').innerHTML = Tables.html(
      ['Set', '% of working', 'Weight (' + unit + ')', 'Reps', 'Rest (s)'], rows
    );
    $$('#wu-table-wrap .wu-w').forEach(inp => inp.addEventListener('input', () => {
      const i = Number(inp.dataset.i); const v = parseFloat(inp.value);
      if (isFinite(v) && v >= 0) sets[i].weight = v;
    }));
    $$('#wu-table-wrap .wu-r').forEach(inp => inp.addEventListener('input', () => {
      const i = Number(inp.dataset.i); const v = parseInt(inp.value, 10);
      if (isFinite(v) && v >= 1) sets[i].reps = v;
    }));
    $$('#wu-table-wrap .wu-t').forEach(inp => inp.addEventListener('input', () => {
      const i = Number(inp.dataset.i); const v = parseInt(inp.value, 10);
      if (isFinite(v) && v >= 0) sets[i].rest = v;
    }));
    const snappedCount = sets.filter(s => s.snapped).length;
    $('#wu-summary').textContent = isFinite(working)
      ? 'Warm-up plan for working weight ' + fmt(working, 2) + ' ' + unit + ' across ' + sets.length +
        ' sets.' + (snappedCount ? ' ' + snappedCount + ' set(s) snapped to a loadable weight.' : '')
      : '';
  }
  function render(){ generate(); }
  function init(){
    fillRoundingSelect($('#wu-round'), Settings.get('rounding'));
    ['#wu-base','#wu-sets','#wu-start','#wu-end','#wu-rest'].forEach(s => $(s).addEventListener('input', render));
    $('#wu-round').addEventListener('change', render);
    $('#wu-basetype').addEventListener('change', render);
    $('#wu-style').addEventListener('change', render);
    $('#wu-plateaware').addEventListener('change', render);
    $('#wu-reset').addEventListener('click', () => {
      $('#wu-sets').value = '5'; $('#wu-start').value = '40'; $('#wu-end').value = '90'; $('#wu-rest').value = '90';
      render();
    });
    $('#wu-print').addEventListener('click', () => window.print());
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelConvert = (function(){
  function render(){
    const value = readNum($('#cv-value'), { min:-100000, max:100000, label:'Value' });
    const from = $('#cv-from').value, to = $('#cv-to').value;
    const prec = readNum($('#cv-precision'), { min:0, max:6, label:'Precision', integer:true });
    const errEl = $('#cv-error');
    if (!value.ok || !prec.ok){ errEl.textContent = !value.ok ? value.msg : prec.msg; $('#cv-result').textContent = '—'; $('#cv-detail').textContent = ''; return; }
    errEl.textContent = '';
    const converted = Units.convert(value.value, from, to);
    const rounded = roundDp(converted, prec.value);
    if (!isFinite(rounded)){ errEl.textContent = 'Conversion produced an invalid result.'; $('#cv-result').textContent = '—'; return; }
    $('#cv-result').textContent = rounded.toFixed(prec.value) + ' ' + to;
    $('#cv-detail').textContent = value.value + ' ' + from + ' = ' + converted.toFixed(6) + ' ' + to + ' (displayed to ' + prec.value + ' dp)';
    const refs = from === 'kg' ? [1,2.5,5,10,20,25,40,50,75,100,150,200] : [1,5,10,25,45,50,100,135,185,225,315,405];
    const rows = refs.map(v => {
      const c = Units.convert(v, from, to);
      return [{ v: v + ' ' + from, raw: v }, { v: c.toFixed(prec.value) + ' ' + to, raw: c.toFixed(prec.value) }];
    });
    $('#cv-table-wrap').innerHTML = Tables.html([from.toUpperCase(), to.toUpperCase()], rows);
  }
  function init(){
    ['#cv-value','#cv-precision'].forEach(s => $(s).addEventListener('input', render));
    $('#cv-from').addEventListener('change', render);
    $('#cv-to').addEventListener('change', render);
    $('#cv-swap').addEventListener('click', () => {
      const oldFrom = $('#cv-from').value;
      const oldTo   = $('#cv-to').value;
      $('#cv-from').value = oldTo;
      $('#cv-to').value   = oldFrom;
      const v = readNum($('#cv-value'), { required:false });
      if (v.ok && v.value !== null){
        const conv = Units.convert(v.value, oldFrom, oldTo);
        if (isFinite(conv)) $('#cv-value').value = roundDp(conv, 4);
      }
      render();
    });
    $('#cv-copy').addEventListener('click', async () => {
      const ok = await copyText($('#cv-result').textContent);
      toast(ok ? 'Copied' : 'Copy failed');
    });
    $('#cv-print').addEventListener('click', () => window.print());
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelScore = (function(){
  function recomputeTotal(){
    const parts = ['#sc-squat','#sc-bench','#sc-dead'].map(s => {
      const r = readNum($(s), { min:0, max:5000, label:'Lift', required:false });
      return (r.ok && r.value !== null) ? r.value : 0;
    });
    $('#sc-total').value = roundDp(parts.reduce((a,b)=>a+b,0), 2);
  }
  function render(){
    const unit = Settings.get('unit');
    const sex = $('#sc-sex').value, system = $('#sc-system').value;
    const bw = readNum($('#sc-bw'), { min:20, max:500, label:'Bodyweight' });
    const total = readNum($('#sc-total'), { min:0, max:5000, label:'Total' });
    const errEl = $('#sc-error');
    if (!bw.ok || !total.ok){ errEl.textContent = !bw.ok ? bw.msg : total.msg; $('#sc-result').textContent = '—'; $('#sc-summary').textContent = ''; $('#sc-breakdown').textContent = ''; return; }
    errEl.textContent = '';
    const bwKg = Units.toKg(bw.value, unit), totalKg = Units.toKg(total.value, unit);
    if (bwKg <= 0){ errEl.textContent = 'Bodyweight must be greater than zero.'; return; }
    const res = Scoring.compute(system, totalKg, bwKg, sex);
    if (!isFinite(res.score)){ errEl.textContent = 'This score cannot be calculated for that bodyweight — check the value and units.'; $('#sc-result').textContent = '—'; $('#sc-breakdown').textContent=''; return; }
    $('#sc-result').textContent = res.score.toFixed(2);
    $('#sc-summary').textContent = res.system + ' points · ' + (sex === 'male' ? 'Male' : 'Female') +
      ' · ' + fmt(bwKg, 2) + ' kg BW · ' + fmt(totalKg, 2) + ' kg total';
    let bd = '';
    bd += 'System:      ' + res.system + '\n';
    bd += 'Category:    ' + (sex === 'male' ? 'Male' : 'Female') + '\n';
    bd += 'Bodyweight:  ' + fmt(bw.value, 2) + ' ' + unit + ' = ' + fmt(bwKg, 3) + ' kg\n';
    bd += 'Total:       ' + fmt(total.value, 2) + ' ' + unit + ' = ' + fmt(totalKg, 3) + ' kg\n\n';
    if (system === 'wilks'){
      bd += 'Wilks (2020): score = total × 600 / (a + b·x + c·x² + d·x³ + e·x⁴ + f·x⁵)\n';
      bd += '  x = ' + fmt(bwKg, 3) + '\n  denominator = ' + fmt(res.denom, 4) + '\n  coefficient = ' + fmt(res.coeff, 6) + '\n';
    } else if (system === 'dots'){
      bd += 'DOTS: score = total × 500 / (a + b·x + c·x² + d·x³ + e·x⁴)\n';
      bd += '  x = ' + fmt(bwKg, 3) + '\n  denominator = ' + fmt(res.denom, 4) + '\n  coefficient = ' + fmt(res.coeff, 6) + '\n';
    } else {
      bd += 'IPF GL: score = total × 100 / (A − B·e^(−C·bodyweight))\n';
      bd += '  bodyweight = ' + fmt(bwKg, 3) + ' kg\n  denominator = ' + fmt(res.denom, 4) + '\n';
    }
    if (res.clamped) bd += '  note: bodyweight clamped to official range → x = ' + fmt(res.xUsed, 2) + ' kg\n';
    if (system === 'ipfgl') bd += '  event: ' + $('#sc-event').selectedOptions[0].textContent + '\n';
    bd += '\nResult: ' + res.score.toFixed(2) + ' points';
    $('#sc-breakdown').textContent = bd;
  }
  function init(){
    ['#sc-squat','#sc-bench','#sc-dead'].forEach(s => $(s).addEventListener('input', () => { recomputeTotal(); render(); }));
    $('#sc-total').addEventListener('input', render);
    $('#sc-bw').addEventListener('input', render);
    $('#sc-sex').addEventListener('change', render);
    $('#sc-system').addEventListener('change', () => { $('#sc-event-wrap').hidden = $('#sc-system').value !== 'ipfgl'; render(); });
    $('#sc-event-wrap').hidden = $('#sc-system').value !== 'ipfgl';
    $('#sc-event').addEventListener('change', render);
    $('#sc-copy').addEventListener('click', async () => {
      const text = $('#sc-result').textContent + ' — ' + $('#sc-summary').textContent;
      const ok = await copyText(text);
      toast(ok ? 'Score copied' : 'Copy failed');
    });
    $('#sc-print').addEventListener('click', () => window.print());
    $('#sc-share-card').addEventListener('click', async () => {
      const unit = Settings.get('unit');
      const sex = $('#sc-sex').value, system = $('#sc-system').value;
      const bw = readNum($('#sc-bw'), { min:20, max:500, label:'Bodyweight' });
      const total = readNum($('#sc-total'), { min:0, max:5000, label:'Total' });
      if (!bw.ok || !total.ok){ $('#sc-error').textContent = !bw.ok ? bw.msg : total.msg; return; }
      const res = Scoring.compute(system, Units.toKg(total.value, unit), Units.toKg(bw.value, unit), sex);
      if (!isFinite(res.score)){ toast('No score to share'); return; }
      await ShareCard.present({
        title: res.system + ' Points',
        category: sex === 'male' ? 'Male' : 'Female',
        hero: res.score.toFixed(1),
        unit: 'pts',
        subtitle: 'Total ' + fmt(total.value, 0) + ' ' + unit + ' at ' + fmt(bw.value, 1) + ' ' + unit + ' bodyweight',
        rows: [
          ['Total', fmt(total.value, 1) + ' ' + unit],
          ['Bodyweight', fmt(bw.value, 1) + ' ' + unit],
          ['System', res.system]
        ],
        filename: 'score'
      });
    });
    $('#sc-rev-go').addEventListener('click', () => {
      const target = readNum($('#sc-rev-target'), { min:1, max:2000, label:'Target score' });
      const bw = readNum($('#sc-bw'), { min:20, max:500, label:'Bodyweight' });
      if (!target.ok || !bw.ok){
        $('#sc-rev-result').textContent = !target.ok ? target.msg : bw.msg;
        return;
      }
      const unit = Settings.get('unit');
      const sex = $('#sc-sex').value, system = $('#sc-system').value;
      const totalKg = Scoring.totalForScore(system, target.value, Units.toKg(bw.value, unit), sex);
      if (!isFinite(totalKg)){ $('#sc-rev-result').textContent = 'No solution found.'; return; }
      const inUnit = Units.fromKg(totalKg, unit);
      $('#sc-rev-result').textContent = 'Required total for ' + target.value + ' pts: about ' +
        fmt(inUnit, 1) + ' ' + unit + ' (' + fmt(totalKg, 1) + ' kg).';
    });
    recomputeTotal();
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelStandards = (function(){
  function render(){
    const unit = Settings.get('unit');
    const ds = Standards.get();
    const exercise = $('#st-exercise').value, sex = $('#st-sex').value;
    const bw = readNum($('#st-bw'), { min:20, max:500, label:'Bodyweight' });
    const lift = readNum($('#st-lift'), { min:0.01, max:5000, label:'Weight lifted' });
    const errEl = $('#st-error');
    $('#st-source').textContent = ds.source + ' ' + ds.methodology;
    if (!bw.ok || !lift.ok){ errEl.textContent = !bw.ok ? bw.msg : lift.msg; $('#st-table-wrap').innerHTML=''; $('#st-result').textContent = '—'; $('#st-summary').textContent=''; return; }
    errEl.textContent = '';
    const ratios = Standards.ratiosFor(exercise, sex);
    if (!ratios){ errEl.textContent = 'No benchmark data for this exercise and category.'; return; }
    const ratio = lift.value / bw.value;
    const levelIdx = Standards.classify(ratio, exercise, sex);
    const levels = Standards.levels();
    $('#st-result').textContent = levels[levelIdx] || '—';
    $('#st-summary').textContent = 'Ratio ' + fmt(ratio, 3) + '× bodyweight on ' +
      $('#st-exercise').selectedOptions[0].textContent + '.';
    const rows = ratios.map((r, i) => {
      const w = r * bw.value;
      return [
        levels[i],
        { v: fmt(r, 2) + '× BW', raw: r },
        { v: fmt(w, 2) + ' ' + unit, raw: w.toFixed(2) },
        ratio >= r ? 'Achieved' : (ratio >= (ratios[i-1] || 0) ? 'Current level' : '—')
      ];
    });
    $('#st-table-wrap').innerHTML = Tables.html(
      ['Level', 'Ratio threshold', 'Weight (' + unit + ')', 'Status'], rows,
      { rowClass: (r, i) => i === levelIdx ? 'standard-row hit' : '' }
    );
  }
  function loadDatasetIntoTextarea(){ $('#st-dataset').value = JSON.stringify(Standards.get(), null, 2); }
  function init(){
    Standards.load();
    loadDatasetIntoTextarea();
    ['#st-bw','#st-lift'].forEach(s => $(s).addEventListener('input', render));
    $('#st-exercise').addEventListener('change', render);
    $('#st-sex').addEventListener('change', render);
    $('#st-print').addEventListener('click', () => window.print());
    $('#st-save-data').addEventListener('click', () => {
      const msg = $('#st-data-msg');
      try {
        const parsed = JSON.parse($('#st-dataset').value);
        if (!parsed || typeof parsed !== 'object' || !parsed.ratios) throw new Error('Dataset must contain a "ratios" object.');
        ['male','female'].forEach(sex => {
          if (!parsed.ratios[sex]) throw new Error('Missing "' + sex + '" ratios.');
          Object.keys(parsed.ratios[sex]).forEach(ex => {
            const arr = parsed.ratios[sex][ex];
            if (!Array.isArray(arr) || arr.length !== 5 || arr.some(v => typeof v !== 'number' || !isFinite(v))){
              throw new Error('Ratio array for "' + sex + '/' + ex + '" must contain 5 finite numbers.');
            }
          });
        });
        if (!parsed.source) parsed.source = 'User-provided dataset.';
        if (!parsed.methodology) parsed.methodology = '';
        Standards.save(parsed);
        msg.className = 'ok'; msg.textContent = 'Dataset saved.';
        render();
      } catch (e){
        msg.className = 'error'; msg.textContent = 'Invalid dataset: ' + e.message;
      }
    });
    $('#st-reset-data').addEventListener('click', () => {
      Standards.reset();
      loadDatasetIntoTextarea();
      $('#st-data-msg').className = 'ok';
      $('#st-data-msg').textContent = 'Default dataset restored.';
      render();
    });
    $('#st-share-card').addEventListener('click', async () => {
      const unit = Settings.get('unit');
      const bw = readNum($('#st-bw'), { min:20, max:500, label:'Bodyweight' });
      const lift = readNum($('#st-lift'), { min:0.01, max:5000, label:'Weight lifted' });
      if (!bw.ok || !lift.ok){ $('#st-error').textContent = !bw.ok ? bw.msg : lift.msg; return; }
      const exercise = $('#st-exercise').value, sex = $('#st-sex').value;
      const ratio = lift.value / bw.value;
      const idx = Standards.classify(ratio, exercise, sex);
      const levels = Standards.levels();
      await ShareCard.present({
        title: $('#st-exercise').selectedOptions[0].textContent + ' Standard',
        category: levels[idx] || 'Unranked',
        hero: fmt(ratio, 2) + '×',
        unit: 'BW',
        subtitle: 'Lift ' + fmt(lift.value, 0) + ' ' + unit + ' at ' + fmt(bw.value, 1) + ' ' + unit + ' bodyweight',
        rows: [
          ['Exercise', $('#st-exercise').selectedOptions[0].textContent],
          ['Category', sex === 'male' ? 'Male' : 'Female'],
          ['Ratio', fmt(ratio, 2) + '×']
        ],
        filename: 'standard'
      });
    });
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelRatio = (function(){
  let comparison = [];
  function exerciseLabel(){
    const v = $('#br-exercise').value;
    if (v === 'custom') return $('#br-custom').value.trim() || 'Custom Exercise';
    const sel = $('#br-exercise');
    return sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : 'Exercise';
  }
  function render(){
    const unit = Settings.get('unit');
    $('#br-custom-wrap').classList.toggle('hidden', $('#br-exercise').value !== 'custom');
    const bw = readNum($('#br-bw'), { min:20, max:500, label:'Bodyweight' });
    const lift = readNum($('#br-lift'), { min:0.01, max:5000, label:'Weight lifted' });
    const errEl = $('#br-error');
    if (!bw.ok || !lift.ok){
      errEl.textContent = !bw.ok ? bw.msg : lift.msg;
      $('#br-result').textContent = '—'; $('#br-breakdown').textContent = ''; $('#br-animal').textContent = '';
      renderTable(); return;
    }
    errEl.textContent = '';
    const ratio = lift.value / bw.value;
    $('#br-result').textContent = fmt(ratio, 3) + '×';
    $('#br-breakdown').textContent =
      'Lift:        ' + fmt(lift.value, 2) + ' ' + unit + '\n' +
      'Bodyweight:  ' + fmt(bw.value, 2) + ' ' + unit + '\n' +
      'Ratio:       ' + fmt(ratio, 4) + '×\n' +
      'Equivalent:  ' + fmt(ratio * 100, 1) + '% of bodyweight';
    const liftKg = Units.toKg(lift.value, unit);
    $('#br-animal').textContent = Animals.phrase(liftKg);
    renderTable();
  }
  function renderTable(){
    const unit = Settings.get('unit');
    if (!comparison.length){ $('#br-table-wrap').innerHTML = '<p class="muted">No lifts added yet.</p>'; return; }
    const rows = comparison.map((c, i) => [
      c.exercise,
      { v: fmt(c.bw, 2) + ' ' + unit, raw: c.bw.toFixed(2) },
      { v: fmt(c.lift, 2) + ' ' + unit, raw: c.lift.toFixed(2) },
      { v: fmt(c.lift / c.bw, 3) + '×', raw: (c.lift/c.bw).toFixed(4) },
      '<button data-remove="' + i + '" class="no-print">Remove</button>'
    ]);
    $('#br-table-wrap').innerHTML = Tables.html(['Exercise','Bodyweight','Lift','Ratio',''], rows);
    $$('#br-table-wrap [data-remove]').forEach(btn => btn.addEventListener('click', () => {
      comparison.splice(Number(btn.dataset.remove), 1); renderTable();
    }));
  }
  function init(){
    ['#br-bw','#br-lift','#br-custom'].forEach(s => $(s).addEventListener('input', render));
    $('#br-exercise').addEventListener('change', render);
    $('#br-add').addEventListener('click', () => {
      const bw = readNum($('#br-bw'), { min:20, max:500, label:'Bodyweight' });
      const lift = readNum($('#br-lift'), { min:0.01, max:5000, label:'Weight lifted' });
      if (!bw.ok || !lift.ok){ $('#br-error').textContent = !bw.ok ? bw.msg : lift.msg; return; }
      comparison.push({ exercise: exerciseLabel(), bw: bw.value, lift: lift.value, unit: Settings.get('unit') });
      renderTable(); toast('Added');
    });
    $('#br-clear').addEventListener('click', () => { comparison = []; renderTable(); });
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelImbalance = (function(){
  function collect(){
    const get = sel => {
      const r = readNum($(sel), { min:0, max:5000, label:'Lift', required:false });
      if (!r.ok || r.value === null) return NaN;
      return r.value;
    };
    return {
      squat: get('#im-squat'), bench: get('#im-bench'), dead: get('#im-dead'),
      press: get('#im-press'), row: get('#im-row')
    };
  }
  function render(){
    const inputs = collect();
    const analysis = Archetype.analyze(inputs);
    $('#im-archetype').textContent = analysis.archetype;
    $('#im-tag').textContent = analysis.tag;

    const meters = $('#im-meters');
    meters.innerHTML = analysis.meters.map(m => {
      if (!isFinite(m.value)){
        return '<div style="margin-bottom:.6rem;">' +
          '<div class="muted">' + esc(m.label) + ' — not enough data</div>' +
          '<div class="meter"><div style="width:0%"></div></div></div>';
      }
      const span = (m.hi - m.lo) || 1;
      const mid = (m.lo + m.hi) / 2;
      const pctVal = Math.max(2, Math.min(100, ((m.value - (mid - span*1.5)) / (span*3)) * 100));
      return '<div style="margin-bottom:.6rem;">' +
        '<div><strong>' + esc(m.label) + '</strong> ' +
        '<span class="muted">your ' + fmt(m.value, 3) + '× · expected ' + fmt(m.mid, 2) + '× (' + fmt(m.lo,2) + '–' + fmt(m.hi,2) + ')</span> ' +
        '<span class="pill ' + (m.level === 'bad' ? 'bad' : m.level === 'warn' ? '' : 'good') + '">' + esc(m.text) + '</span></div>' +
        '<div class="meter ' + (m.level === 'bad' ? 'bad' : m.level === 'warn' ? 'warn' : '') + '"><div style="width:' + pctVal.toFixed(1) + '%"></div></div>' +
        '</div>';
    }).join('');
  }
  function fillFromPRs(){
    const prs = Tracker.personalRecords();
    const unit = Settings.get('unit');
    const map = { squat:'#im-squat', bench:'#im-bench', dead:'#im-dead', press:'#im-press', row:'#im-row' };
    Object.keys(map).forEach(k => {
      const pr = prs[k] || (k === 'dead' ? prs.deadlift : null);
      if (pr){
        const v = Units.fromKg(pr.e1rmKg, unit);
        $(map[k]).value = roundDp(v, 1);
      }
    });
    render();
    toast('Filled from tracker PRs');
  }
  function init(){
    ['#im-squat','#im-bench','#im-dead','#im-press','#im-row'].forEach(s => $(s).addEventListener('input', render));
    $('#im-use-prs').addEventListener('click', fillFromPRs);
    $('#im-share-card').addEventListener('click', async () => {
      const inputs = collect();
      const analysis = Archetype.analyze(inputs);
      const rows = Object.keys(analysis.ratios).map(k => [k.replace(':', ' : '), fmt(analysis.ratios[k], 3) + '×']);
      await ShareCard.present({
        title: 'Lifter Archetype',
        category: analysis.archetype,
        hero: '',
        unit: '',
        subtitle: analysis.tag,
        rows: rows,
        filename: 'archetype'
      });
    });
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelProgram = (function(){
  function render(){
    const unit = Settings.get('unit');
    const style = $('#pg-style').value;
    const weeks = readNum($('#pg-weeks'), { min:1, max:16, label:'Weeks', integer:true });
    const squat = readNum($('#pg-squat'), { min:0, max:5000, label:'Squat TM', required:false });
    const bench = readNum($('#pg-bench'), { min:0, max:5000, label:'Bench TM', required:false });
    const dead = readNum($('#pg-dead'), { min:0, max:5000, label:'Deadlift TM', required:false });
    const press = readNum($('#pg-press'), { min:0, max:5000, label:'OHP TM', required:false });
    const errEl = $('#pg-error');
    if (!weeks.ok){ errEl.textContent = weeks.msg; $('#pg-table-wrap').innerHTML = ''; $('#pg-summary').textContent = ''; return; }
    errEl.textContent = '';
    const tms = {
      squat: squat.ok && squat.value !== null ? squat.value : 0,
      bench: bench.ok && bench.value !== null ? bench.value : 0,
      dead:  dead.ok  && dead.value  !== null ? dead.value  : 0,
      press: press.ok && press.value !== null ? press.value : 0
    };
    if (!tms.squat && !tms.bench && !tms.dead && !tms.press){
      errEl.textContent = 'Enter at least one training max.';
      $('#pg-table-wrap').innerHTML = ''; return;
    }
    const program = Programs.generate(style, tms, weeks.value, unit);
    const styleLabel = $('#pg-style').selectedOptions[0].textContent;
    $('#pg-summary').textContent = styleLabel + ' · ' + weeks.value + ' week' + (weeks.value===1?'':'s') +
      ' · loads in ' + unit + '. Training maxes: SQ ' + fmt(tms.squat, 0) + ' · BP ' + fmt(tms.bench, 0) +
      ' · DL ' + fmt(tms.dead, 0) + ' · OHP ' + fmt(tms.press, 0);

    const html = program.map(w => {
      let t = '<div class="program-week"><h3>' + esc(w.label) + '</h3>';
      w.days.forEach(d => {
        t += '<h4 style="margin:.4rem 0 .2rem;">' + esc(d.name) + '</h4>';
        t += Tables.html(
          ['Exercise', 'Sets', 'Reps', 'Weight (' + unit + ')'],
          d.sets.map(s => [
            s.exercise,
            { v: String(s.sets), raw: s.sets },
            { v: String(s.reps), raw: s.reps },
            { v: (typeof s.weight === 'number' && isFinite(s.weight)) ? fmt(s.weight, 1) : String(s.weight),
              raw: (typeof s.weight === 'number' && isFinite(s.weight)) ? s.weight.toFixed(1) : String(s.weight) }
          ])
        );
      });
      return t + '</div>';
    }).join('');
    $('#pg-table-wrap').innerHTML = html;
  }
  function fillFromPRs(){
    const prs = Tracker.personalRecords();
    const unit = Settings.get('unit');
    const setter = (sel, pr, factor) => {
      if (!pr) return;
      const v = Units.fromKg(pr.e1rmKg, unit);
      $(sel).value = roundDp(v * (factor || 0.9), 1);
    };
    setter('#pg-squat', prs.squat);
    setter('#pg-bench', prs.bench);
    setter('#pg-dead', prs.deadlift);
    setter('#pg-press', prs.press);
    render();
    toast('Filled from tracker PRs (90% of estimated 1RM)');
  }
  function exportCSV(){
    const unit = Settings.get('unit');
    const style = $('#pg-style').value;
    const weeks = readNum($('#pg-weeks'), { min:1, max:16, label:'Weeks', integer:true });
    if (!weeks.ok){ $('#pg-error').textContent = weeks.msg; return; }
    const tms = {
      squat: parseFloat($('#pg-squat').value) || 0,
      bench: parseFloat($('#pg-bench').value) || 0,
      dead:  parseFloat($('#pg-dead').value)  || 0,
      press: parseFloat($('#pg-press').value) || 0
    };
    if (!tms.squat && !tms.bench && !tms.dead && !tms.press){ toast('Nothing to export'); return; }
    const program = Programs.generate(style, tms, weeks.value, unit);
    const rows = [['Week','Day','Exercise','Sets','Reps','Weight (' + unit + ')']];
    program.forEach(w => {
      w.days.forEach(d => {
        d.sets.forEach(s => {
          rows.push([w.label, d.name, s.exercise, s.sets, s.reps,
            (typeof s.weight === 'number' && isFinite(s.weight)) ? s.weight.toFixed(1) : String(s.weight)]);
        });
      });
    });
    downloadFile('program.csv', Tables.toCSV(rows));
    toast('Program exported');
  }
  function init(){
    $('#pg-style').addEventListener('change', render);
    ['#pg-weeks','#pg-squat','#pg-bench','#pg-dead','#pg-press'].forEach(s => $(s).addEventListener('input', render));
    $('#pg-use-prs').addEventListener('click', fillFromPRs);
    $('#pg-csv').addEventListener('click', exportCSV);
    $('#pg-print').addEventListener('click', () => window.print());
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelBulk = (function(){
  let entries = [];
  let seq = 0;
  function addEntry(data){
    entries.push(Object.assign({ id: ++seq, exercise:'', weight:'', reps:'', formula: $('#bk-formula').value }, data || {}));
    renderEntries(); renderResults();
  }
  function renderEntries(){
    const perEntry = $('#bk-mode').value === 'entry';
    const host = $('#bk-entries'); host.innerHTML = '';
    if (!entries.length){ host.innerHTML = '<p class="muted">No entries yet — use "Add entry".</p>'; return; }
    entries.forEach((e, idx) => {
      const row = document.createElement('div');
      row.className = 'session-row';
      row.style.gridTemplateColumns = perEntry ? '1.4fr .8fr .7fr 1fr auto' : '1.4fr .8fr .7fr auto';
      row.innerHTML =
        '<label style="margin:0;">Exercise<input type="text" data-k="exercise" data-i="' + idx + '" value="' + esc(e.exercise) + '" placeholder="Exercise name"></label>' +
        '<label style="margin:0;">Weight (<span class="u"></span>)<input type="number" step="0.5" min="0" data-k="weight" data-i="' + idx + '" value="' + esc(e.weight) + '"></label>' +
        '<label style="margin:0;">Reps<input type="number" step="1" min="1" max="36" data-k="reps" data-i="' + idx + '" value="' + esc(e.reps) + '"></label>' +
        (perEntry ? '<label style="margin:0;">Formula<select data-k="formula" data-i="' + idx + '">' +
          Formulas.all().map(f => '<option value="' + f.id + '"' + (f.id === e.formula ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') +
          '</select></label>' : '') +
        '<button data-remove="' + idx + '" class="danger no-print">Remove</button>';
      host.appendChild(row);
    });
    $$('#bk-entries input, #bk-entries select').forEach(inp => {
      const handler = () => {
        const i = Number(inp.dataset.i), k = inp.dataset.k;
        entries[i][k] = inp.value;
        renderResults();
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });
    $$('#bk-entries [data-remove]').forEach(btn => btn.addEventListener('click', () => {
      entries.splice(Number(btn.dataset.remove), 1); renderEntries(); renderResults();
    }));
    $$('#bk-entries .u').forEach(el => { el.textContent = Settings.get('unit'); });
  }
  function renderResults(){
    const unit = Settings.get('unit');
    const sessionFormula = $('#bk-formula').value;
    const perEntry = $('#bk-mode').value === 'entry';
    const rows = [];
    let totalVolume = 0, validCount = 0;
    let errorMsg = '';
    entries.forEach((e, idx) => {
      const wRaw = String(e.weight).trim(), rRaw = String(e.reps).trim();
      if (wRaw === '' && rRaw === '') return;
      if (!NUMERIC_RE.test(wRaw) || !NUMERIC_RE.test(rRaw)){
        rows.push([e.exercise || '(entry ' + (idx+1) + ')', wRaw || '—', rRaw || '—', 'invalid input', '—', '—']);
        errorMsg = 'Some entries contain invalid values and were skipped.'; return;
      }
      const w = Number(wRaw), r = Number(rRaw);
      if (!isFinite(w) || w <= 0 || !isFinite(r) || r < 1){
        rows.push([e.exercise || '(entry ' + (idx+1) + ')', wRaw, rRaw, 'invalid input', '—', '—']);
        errorMsg = 'Some entries contain out-of-range values and were skipped.'; return;
      }
      const fid = perEntry ? (e.formula || sessionFormula) : sessionFormula;
      const e1rmVal = Formulas.calc(fid, w, r);
      const cons = Formulas.consensus(w, r);
      if (isFinite(e1rmVal)){ validCount++; totalVolume += w * r; }
      rows.push([
        e.exercise || '(entry ' + (idx+1) + ')',
        { v: fmt(w, 2), raw: w.toFixed(2) },
        { v: String(r), raw: r },
        Formulas.get(fid).name,
        { v: isFinite(e1rmVal) ? fmt(e1rmVal, 2) : '—', raw: isFinite(e1rmVal) ? e1rmVal.toFixed(2) : '' },
        { v: isFinite(cons) ? fmt(cons, 2) : '—', raw: isFinite(cons) ? cons.toFixed(2) : '' }
      ]);
    });
    $('#bk-error').textContent = errorMsg;
    if (!rows.length){ $('#bk-table-wrap').innerHTML = '<p class="muted">No valid entries.</p>'; $('#bk-summary').textContent = ''; return; }
    $('#bk-table-wrap').innerHTML = Tables.html(
      ['Exercise', 'Weight (' + unit + ')', 'Reps', 'Formula', 'Est. 1RM (' + unit + ')', 'Consensus (' + unit + ')'], rows
    );
    $('#bk-summary').textContent = validCount + ' valid entr' + (validCount === 1 ? 'y' : 'ies') +
      ' · total volume ' + fmt(totalVolume, 2) + ' ' + unit;
  }
  function init(){
    Formulas.populateSelect($('#bk-formula'), { consensus:false, value: Settings.get('formula') });
    $('#bk-formula').addEventListener('change', () => {
      if ($('#bk-mode').value === 'session'){ entries.forEach(e => { e.formula = $('#bk-formula').value; }); renderEntries(); }
      renderResults();
    });
    $('#bk-mode').addEventListener('change', renderEntries);
    $('#bk-add').addEventListener('click', () => addEntry());
    $('#bk-print').addEventListener('click', () => window.print());
    $('#bk-log').addEventListener('click', () => {
      const unit = Settings.get('unit');
      const today = new Date().toISOString().slice(0,10);
      let count = 0;
      entries.forEach(e => {
        const w = Number(String(e.weight).trim()), r = parseInt(String(e.reps).trim(), 10);
        if (!isFinite(w) || w <= 0 || !isFinite(r) || r < 1) return;
        if (!e.exercise || !e.exercise.trim()) return;
        Tracker.add({ date: today, exercise: e.exercise, weight: w, reps: r, unit: unit, notes: 'Logged from Bulk Calculator' });
        count++;
      });
      toast(count ? 'Logged ' + count + ' record' + (count===1?'':'s') : 'No valid entries to log');
    });
    registerUnitConverter((oldUnit, newUnit) => {
      entries.forEach(e => {
        if (e.weight === '' || e.weight === undefined) return;
        const v = parseFloat(e.weight);
        if (isFinite(v)) e.weight = String(roundDp(Units.convert(v, oldUnit, newUnit), 1));
      });
      renderEntries();
    });
    addEntry({ exercise:'Bench Press', weight:100, reps:5 });
    addEntry({ exercise:'Squat', weight:140, reps:3 });
    renderEntries(); renderResults();
  }
  registerRenderer(renderResults);
  return { init, render: renderResults };
})();

const PanelTracker = (function(){
  let editingId = null;
  function todayISO(){
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }
  function fillExerciseFilter(){
    const sel = $('#tk-filter-ex');
    const cur = sel.value;
    const names = Array.from(new Set(Tracker.all().map(r => r.exercise).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All exercises</option>' +
      names.map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
    if (cur && names.indexOf(cur) >= 0) sel.value = cur;
  }
  function filteredRecords(){
    const ex = $('#tk-filter-ex').value;
    const from = $('#tk-from').value;
    const to = $('#tk-to').value;
    return Tracker.all().filter(r => {
      if (ex && r.exercise !== ex) return false;
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    }).sort((a,b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  function renderPRs(){
    const prs = Tracker.personalRecords();
    const unit = Settings.get('unit');
    const keys = Object.keys(prs).sort();
    if (!keys.length){ $('#tk-pr-wrap').innerHTML = '<p class="muted">No personal records yet.</p>'; return; }
    const rows = keys.map(k => {
      const p = prs[k];
      const e1 = Units.fromKg(p.e1rmKg, unit);
      return [p.exercise, { v: fmt(e1, 2) + ' ' + unit, raw: e1.toFixed(2) }, p.record.date,
              p.record.weight + ' ' + (p.record.unit || 'kg') + ' × ' + p.record.reps];
    });
    $('#tk-pr-wrap').innerHTML = Tables.html(['Exercise','Best estimated 1RM','Date','Set'], rows);
  }
  function renderChart(){
    const unit = Settings.get('unit');
    const ex = $('#tk-filter-ex').value;
    const recs = filteredRecords().slice().reverse();
    let points, labelText;
    if (ex){
      points = recs.map(r => {
        const kg = Units.toKg(r.weight, r.unit || 'kg');
        const e = Formulas.calc('epley', kg, Math.min(r.reps, Formulas.get('epley').hardMax));
        return { x: new Date(r.date + 'T00:00:00'), y: Units.fromKg(e, unit), label: r.date + ': ' + fmt(Units.fromKg(e, unit), 1) + ' ' + unit };
      }).filter(p => isFinite(p.y));
      labelText = 'Estimated 1RM for ' + esc(ex) + ' — Epley formula.';
    } else {
      const byDate = {};
      recs.forEach(r => {
        const kg = Units.toKg(r.weight, r.unit || 'kg');
        const e = Formulas.calc('epley', kg, Math.min(r.reps, Formulas.get('epley').hardMax));
        if (!isFinite(e)) return;
        if (!byDate[r.date] || e > byDate[r.date]) byDate[r.date] = e;
      });
      points = Object.keys(byDate).sort().map(d => ({
        x: new Date(d + 'T00:00:00'),
        y: Units.fromKg(byDate[d], unit),
        label: d + ': ' + fmt(Units.fromKg(byDate[d], unit), 1) + ' ' + unit
      }));
      labelText = 'Best estimated 1RM per session date (all exercises) — Epley.';
    }
    $('#tk-chart-wrap').innerHTML = Chart.line(points, { label: 'Estimated 1RM over time', height: 220 }) +
      '<p class="muted">' + labelText + '</p>';

    const fit = Chart.linearFit(points);
    if (fit && points.length >= 3){
      const last = points[points.length - 1].x.getTime();
      const weeks = [4, 8, 12].map(w => {
        const t = last + w * 7 * 86400000;
        const y = fit.intercept + fit.slope * ((t - fit.x0) / 86400000);
        return { w, y };
      });
      const perWeek = fit.slope * 7;
      $('#tk-projection').innerHTML = '<p class="muted">Linear trend: ' +
        (perWeek >= 0 ? '+' : '') + fmt(perWeek, 2) + ' ' + unit + ' per week. ' +
        'Projected: ' + weeks.map(p => p.w + 'wk ≈ ' + fmt(p.y, 1) + ' ' + unit).join(' · ') +
        '. (Straight-line projection, not a promise.)</p>';
    } else {
      $('#tk-projection').innerHTML = '';
    }
  }
  function renderList(){
    const unit = Settings.get('unit');
    const recs = filteredRecords();
    const prs = Tracker.personalRecords();
    const host = $('#tk-list');
    if (!recs.length){ host.innerHTML = '<p class="muted">No records match the current filters.</p>'; $('#tk-count').textContent = ''; return; }
    host.innerHTML = recs.map(r => {
      const kg = Units.toKg(r.weight, r.unit || 'kg');
      const e1 = Formulas.calc('epley', kg, Math.min(r.reps, Formulas.get('epley').hardMax));
      const e1Display = isFinite(e1) ? Units.fromKg(e1, unit) : NaN;
      const key = (r.exercise || '').trim().toLowerCase();
      const isPR = prs[key] && prs[key].record.id === r.id;
      return '<div class="record">' +
        '<div class="rec-head">' +
          '<div><strong>' + esc(r.exercise) + '</strong> ' + (isPR ? '<span class="pill good">PR</span>' : '') +
            '<br><span class="muted">' + esc(r.date) + ' · ' + fmt(r.weight, 2) + ' ' + esc(r.unit || 'kg') +
            ' × ' + r.reps + ' reps' + (r.notes ? ' · ' + esc(r.notes) : '') + '</span></div>' +
          '<div style="text-align:right;"><div class="muted">Est. 1RM</div><strong>' +
            (isFinite(e1Display) ? fmt(e1Display, 2) + ' ' + unit : '—') + '</strong></div>' +
        '</div>' +
        '<div class="row no-print">' +
          '<button data-edit="' + r.id + '">Edit</button>' +
          '<button data-del="' + r.id + '" class="danger">Delete</button>' +
        '</div></div>';
    }).join('');
    $('#tk-count').textContent = recs.length + ' record' + (recs.length === 1 ? '' : 's') + ' shown.';
    $$('#tk-list [data-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.dataset.edit)));
    $$('#tk-list [data-del]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('Delete this record?')) return;
      Tracker.remove(b.dataset.del);
      if (editingId === b.dataset.del) cancelEdit();
      refresh();
    }));
  }
  function startEdit(id){
    const r = Tracker.get(id); if (!r) return;
    editingId = id;
    $('#tk-date').value = r.date;
    $('#tk-exercise').value = r.exercise;
    $('#tk-weight').value = r.weight;
    $('#tk-reps').value = r.reps;
    $('#tk-notes').value = r.notes || '';
    $('#tk-cancel').classList.remove('hidden');
    $('#tk-save').textContent = 'Update record';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit(){
    editingId = null;
    $('#tk-date').value = todayISO();
    $('#tk-exercise').value = ''; $('#tk-weight').value = ''; $('#tk-reps').value = ''; $('#tk-notes').value = '';
    $('#tk-cancel').classList.add('hidden');
    $('#tk-save').textContent = 'Save record';
  }
  function refresh(){ fillExerciseFilter(); renderPRs(); renderChart(); renderList(); }
  function init(){
    Tracker.load();
    $('#tk-date').value = todayISO();
    $('#tk-save').addEventListener('click', () => {
      const err = $('#tk-error');
      const date = $('#tk-date').value;
      const exercise = $('#tk-exercise').value.trim();
      const w = readNum($('#tk-weight'), { min:0.01, max:5000, label:'Weight' });
      const r = readNum($('#tk-reps'), { min:1, max:36, label:'Reps', integer:true });
      if (!validISO(date)){ err.textContent = 'A valid date is required.'; return; }
      if (!exercise){ err.textContent = 'Exercise name is required.'; return; }
      if (!w.ok){ err.textContent = w.msg; return; }
      if (!r.ok){ err.textContent = r.msg; return; }
      err.textContent = '';
      const payload = {
        date: date, exercise: exercise, weight: w.value, reps: r.value,
        unit: Settings.get('unit'), notes: $('#tk-notes').value.trim()
      };
      if (editingId){ Tracker.update(editingId, payload); cancelEdit(); toast('Updated'); }
      else { Tracker.add(payload); toast('Saved'); }
      $('#tk-weight').value = ''; $('#tk-reps').value = ''; $('#tk-notes').value = '';
      refresh();
    });
    $('#tk-cancel').addEventListener('click', cancelEdit);
    $('#tk-export').addEventListener('click', () => {
      const recs = Tracker.all();
      if (!recs.length){ toast('No history to export'); return; }
      const unit = Settings.get('unit');
      const rows = [['date','exercise','weight','unit','reps','estimated_1rm','notes']];
      recs.slice().sort((a,b) => (a.date < b.date ? -1 : 1)).forEach(r => {
        const kg = Units.toKg(r.weight, r.unit || 'kg');
        const e1 = Formulas.calc('epley', kg, Math.min(r.reps, Formulas.get('epley').hardMax));
        rows.push([r.date, r.exercise, r.weight, r.unit || 'kg', r.reps,
          isFinite(e1) ? Units.fromKg(e1, unit).toFixed(2) : '', r.notes || '']);
      });
      downloadFile('training-history.csv', Tables.toCSV(rows));
      toast('Exported');
    });
    $('#tk-import-btn').addEventListener('click', () => $('#tk-import').click());
    $('#tk-import').addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = Tables.parseCSV(String(reader.result));
          if (rows.length < 2) throw new Error('File appears to be empty.');
          const header = rows[0].map(h => h.trim().toLowerCase());
          const idx = {
            date: header.indexOf('date'), exercise: header.indexOf('exercise'),
            weight: header.indexOf('weight'), unit: header.indexOf('unit'),
            reps: header.indexOf('reps'), notes: header.indexOf('notes')
          };
          if (idx.date < 0 || idx.exercise < 0 || idx.weight < 0 || idx.reps < 0){
            throw new Error('Required columns (date, exercise, weight, reps) not found.');
          }
          if (rows.length > 5000) throw new Error('File exceeds 5000 rows.');
          let imported = 0, rejected = 0;
          for (let i = 1; i < rows.length; i++){
            const row = rows[i];
            const date = (row[idx.date] || '').trim();
            const exercise = (row[idx.exercise] || '').trim();
            const weight = Number((row[idx.weight] || '').trim());
            const reps = Number((row[idx.reps] || '').trim());
            const unit = (idx.unit >= 0 ? (row[idx.unit] || '').trim() : '') || 'kg';
            const notes = idx.notes >= 0 ? (row[idx.notes] || '').trim() : '';
            if (!validISO(date) || !exercise || !isFinite(weight) || weight <= 0 || !isFinite(reps) || reps < 1){ rejected++; continue; }
            Tracker.add({ date, exercise, weight, reps, unit: (unit === 'lb' || unit === 'kg') ? unit : 'kg', notes });
            imported++;
          }
          refresh();
          toast('Imported ' + imported + (rejected ? ', ' + rejected + ' skipped' : ''));
        } catch (e){
          $('#tk-error').textContent = 'Import failed: ' + e.message;
        }
        ev.target.value = '';
      };
      reader.readAsText(file);
    });
    $('#tk-delete-all').addEventListener('click', () => {
      if (!confirm('Delete ALL stored training history? This cannot be undone.')) return;
      Tracker.clearAll(); refresh(); toast('All history deleted');
    });
    ['#tk-filter-ex','#tk-from','#tk-to'].forEach(s => $(s).addEventListener('change', () => { renderChart(); renderList(); }));
    $('#tk-clear-filters').addEventListener('click', () => {
      $('#tk-filter-ex').value = ''; $('#tk-from').value = ''; $('#tk-to').value = '';
      renderChart(); renderList();
    });
    refresh();
  }
  registerRenderer(refresh);
  return { init, render: refresh, refresh };
})();

const PanelBadges = (function(){
  function render(){
    const prs = Tracker.personalRecords();
    const unit = Settings.get('unit');
    let bwKg = 0;
    const bwInput = $('#badges-bw');
    if (bwInput){
      const b = readNum(bwInput, { min:20, max:500, label:'Bodyweight', required:false });
      if (b.ok && b.value !== null) bwKg = Units.toKg(b.value, unit);
    }
    const evaluated = Badges.evaluate(prs, bwKg);
    const unlocked = evaluated.filter(b => b.unlocked).length;
    $('#badges-progress').textContent = unlocked + ' / ' + evaluated.length + ' badges unlocked';
    $('#badges-grid').innerHTML = evaluated.map(b =>
      '<div class="badge ' + (b.unlocked ? 'unlocked' : 'locked') + '">' +
        '<div class="badge-name">' + esc(b.name) + '</div>' +
        '<div class="badge-desc">' + esc(b.desc) + '</div>' +
      '</div>'
    ).join('');
  }
  function init(){
    $('#badges-bw').addEventListener('input', render);
    $('#badges-goto-tracker').addEventListener('click', () => Tabs.show('tracker'));
    $('#badges-share-card').addEventListener('click', async () => {
      const prs = Tracker.personalRecords();
      const unit = Settings.get('unit');
      const bwInput = readNum($('#badges-bw'), { min:20, max:500, label:'Bodyweight', required:false });
      const bwKg = (bwInput.ok && bwInput.value !== null) ? Units.toKg(bwInput.value, unit) : 0;
      const ev = Badges.evaluate(prs, bwKg);
      const unlocked = ev.filter(b => b.unlocked);
      const rows = unlocked.slice(0, 8).map(b => [b.name, b.desc]);
      await ShareCard.present({
        title: 'Milestone Badges',
        category: unlocked.length + ' / ' + ev.length + ' unlocked',
        hero: String(unlocked.length),
        unit: 'badges',
        subtitle: unlocked.length ? 'Unlocked from saved training records' : 'No badges yet — add lifts in the Tracker',
        rows: rows,
        filename: 'badges'
      });
    });
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

const PanelAttempts = (function(){
  const LIFTS = [
    { key:'squat', label:'Squat',        input:'#at-squat' },
    { key:'bench', label:'Bench Press',  input:'#at-bench' },
    { key:'dead',  label:'Deadlift',     input:'#at-dead' }
  ];
  let attempts = { squat:[NaN,NaN,NaN], bench:[NaN,NaN,NaN], dead:[NaN,NaN,NaN] };
  let built = false;
  let builtUnit = null;

  function computeAttempts(target, inc){
    if (!isFinite(target) || target <= 0) return [NaN, NaN, NaN];
    return [
      roundTo(target * 0.90, inc),
      roundTo(target * 0.96, inc),
      roundTo(target * 1.02, inc)
    ];
  }
  function buildTable(){
    const unit = Settings.get('unit');
    const rows = LIFTS.map(l => {
      const a = attempts[l.key];
      return [
        l.label,
        { v: '—', raw: '' },
        '<input type="number" class="at-input attempt-input" data-lift="' + l.key + '" data-i="0" step="0.5" min="0" value="' + (isFinite(a[0]) ? a[0] : '') + '" aria-label="' + l.label + ' opener">',
        '<input type="number" class="at-input attempt-input" data-lift="' + l.key + '" data-i="1" step="0.5" min="0" value="' + (isFinite(a[1]) ? a[1] : '') + '" aria-label="' + l.label + ' second attempt">',
        '<input type="number" class="at-input attempt-input" data-lift="' + l.key + '" data-i="2" step="0.5" min="0" value="' + (isFinite(a[2]) ? a[2] : '') + '" aria-label="' + l.label + ' third attempt">',
        { v: '—', raw: '' }
      ];
    });
    $('#at-table-wrap').innerHTML = Tables.html(
      ['Lift','Target (' + unit + ')','Opener (1st)','2nd attempt','3rd attempt','3rd vs target'], rows
    );
    $$('#at-table-wrap .at-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const lift = inp.dataset.lift, i = Number(inp.dataset.i);
        const v = parseFloat(inp.value);
        attempts[lift][i] = isFinite(v) ? v : NaN;
        updateSummary();
      });
    });
    built = true;
    builtUnit = unit;
  }
  function updateSummary(){
    const unit = Settings.get('unit');
    const inc = Number($('#at-increment').value) || 2.5;
    const roundInc = Number($('#at-round').value) || inc;
    let errorMsg = '';
    let projectedTotal = 0;
    const projections = [];

    LIFTS.forEach((l, idx) => {
      const t = readNum($(l.input), { min:0, max:5000, label:l.label + ' target', required:false });
      const target = (t.ok && t.value !== null) ? t.value : 0;
      const a = attempts[l.key];
      const tr = $('#at-table-wrap tbody tr:nth-child(' + (idx+1) + ')');
      if (tr){
        const cells = tr.querySelectorAll('td');
        cells[1].textContent = t.ok ? fmt(target, 2) : '—';
        cells[1].dataset.value = t.ok ? target.toFixed(2) : '';
        cells[5].textContent = isFinite(a[2]) ? fmt(a[2] - target, 2) : '—';
        cells[5].dataset.value = isFinite(a[2]) ? (a[2] - target).toFixed(2) : '';
      }
      const valid = a.every(x => isFinite(x) && x > 0);
      if (valid){
        if (a[1] - a[0] < inc - 1e-9) errorMsg = errorMsg || (l.label + ': 2nd must exceed opener by ≥ ' + inc + ' ' + unit + '.');
        if (a[2] - a[1] < inc - 1e-9) errorMsg = errorMsg || (l.label + ': 3rd must exceed 2nd by ≥ ' + inc + ' ' + unit + '.');
        if (a[0] > a[2]) errorMsg = errorMsg || (l.label + ': attempts not in ascending order.');
        projectedTotal += a[2];
        projections.push({ label: l.label, target, a });
      } else if (target > 0){
        errorMsg = errorMsg || (l.label + ': enter all three attempts.');
      }
    });

    $('#at-error').textContent = errorMsg;
    $('#at-summary').textContent =
      'Min increment ' + inc + ' ' + unit + ' · rounding ' + roundInc + ' ' + unit +
      ' · projected total (3rd attempts): ' + (isFinite(projectedTotal) ? fmt(projectedTotal, 2) : '—') + ' ' + unit;

    let proj = 'Attempt progression\n-------------------\n';
    projections.forEach(p => {
      proj += p.label + ' (target ' + fmt(p.target, 2) + ' ' + unit + ')\n';
      proj += '  1st: ' + fmt(p.a[0], 2) + '  (' + fmt(p.target > 0 ? p.a[0]/p.target*100 : 0, 1) + '%)\n';
      proj += '  2nd: ' + fmt(p.a[1], 2) + '  (' + fmt(p.target > 0 ? p.a[1]/p.target*100 : 0, 1) + '%)\n';
      proj += '  3rd: ' + fmt(p.a[2], 2) + '  (' + fmt(p.target > 0 ? p.a[2]/p.target*100 : 0, 1) + '%)\n';
    });
    proj += '\nProjected total: ' + fmt(projectedTotal, 2) + ' ' + unit;
    proj += '\n\nThese are estimates only, not guaranteed competition results.';
    const inventory = (function(){
      try {
        const raw = localStorage.getItem('orm_inventory_v1');
        if (raw){ const p = JSON.parse(raw); if (p && p[unit]) return PlateMath.DENOMINATIONS[unit].map(w => ({ w, count: p[unit][w] || 0 })); }
      } catch (e){}
      return PlateMath.DENOMINATIONS[unit].map(w => ({ w, count: (PlateMath.DEFAULT_COUNTS[unit][w] || 0) }));
    })();
    const bar = PlateMath.BARS[unit][0];
    proj += '\n\nPlate loading for 3rd attempts (per side)\n----------------------------------------\n';
    projections.forEach(p => {
      const sol = PlateMath.solve(p.a[2], bar, inventory);
      const loadText = sol && sol.plates && sol.plates.length
        ? PlateMath.group(sol.plates).map(g => g.n + '×' + g.w).join(' + ')
        : '(none)';
      proj += p.label + ': ' + fmt(p.a[2], 2) + ' ' + unit + ' → ' + loadText +
        (sol && !sol.exact ? '  [achievable: ' + fmt(sol.total, 2) + ' ' + unit + ']' : '') + '\n';
    });
    $('#at-projection').textContent = proj;
  }
  function recalc(){
    const unit = Settings.get('unit');
    const roundInc = Number($('#at-round').value) || 2.5;
    LIFTS.forEach(l => {
      const t = readNum($(l.input), { min:0, max:5000, label:l.label, required:false });
      const target = (t.ok && t.value !== null) ? t.value : 0;
      attempts[l.key] = computeAttempts(target, roundInc);
    });
    if (!built || builtUnit !== unit){
      buildTable();
    } else {
      LIFTS.forEach((l, idx) => {
        const tr = $('#at-table-wrap tbody tr:nth-child(' + (idx+1) + ')');
        if (!tr) return;
        const inputs = tr.querySelectorAll('input.at-input');
        attempts[l.key].forEach((v, i) => { if (inputs[i]) inputs[i].value = isFinite(v) ? v : ''; });
      });
    }
    updateSummary();
  }
  function fillFromPRs(){
    const prs = Tracker.personalRecords();
    const unit = Settings.get('unit');
    const setter = (sel, pr, factor) => {
      if (!pr) return;
      const v = Units.fromKg(pr.e1rmKg, unit);
      $(sel).value = roundDp(v * (factor || 0.95), 1);
    };
    setter('#at-squat', prs.squat);
    setter('#at-bench', prs.bench);
    setter('#at-dead',  prs.deadlift);
    recalc();
    toast('Filled from tracker PRs');
  }
  function init(){
    fillRoundingSelect($('#at-increment'), 2.5);
    fillRoundingSelect($('#at-round'), 2.5);
    $('#at-recalc').addEventListener('click', recalc);
    ['#at-squat','#at-bench','#at-dead'].forEach(s => $(s).addEventListener('input', recalc));
    $('#at-round').addEventListener('change', recalc);
    $('#at-increment').addEventListener('change', updateSummary);
    $('#at-split').addEventListener('click', () => {
      const t = readNum($('#at-target-total'), { min:0.01, max:10000, label:'Target total' });
      if (!t.ok){ $('#at-error').textContent = t.msg; return; }
      const inc = Number($('#at-round').value) || 2.5;
      $('#at-squat').value = roundTo(t.value * 0.35, inc);
      $('#at-bench').value = roundTo(t.value * 0.25, inc);
      $('#at-dead').value  = roundTo(t.value * 0.40, inc);
      recalc();
      toast('Split 35% / 25% / 40%');
    });
    $('#at-use-prs').addEventListener('click', fillFromPRs);
    $('#at-print').addEventListener('click', () => window.print());
    $('#at-share-card').addEventListener('click', async () => {
      const unit = Settings.get('unit');
      const rows = [];
      let total = 0;
      LIFTS.forEach(l => {
        const t = readNum($(l.input), { min:0, max:5000, label:l.label, required:false });
        const target = (t.ok && t.value !== null) ? t.value : 0;
        const a = attempts[l.key];
        if (a.every(x => isFinite(x))) { total += a[2]; rows.push([l.label + ' 3rd', fmt(a[2], 1) + ' ' + unit]); }
      });
      await ShareCard.present({
        title: 'Meet Attempt Plan',
        category: 'Projected ' + fmt(total, 0) + ' ' + unit,
        hero: fmt(total, 0),
        unit: unit,
        subtitle: 'Suggested opening / second / third attempts',
        rows: rows,
        filename: 'attempt-plan'
      });
    });
    recalc();
  }
  registerRenderer(() => { recalc(); });
  return { init, render: recalc };
})();

const PanelCompare = (function(){
  const LIFTS = [['squat','Squat'], ['bench','Bench'], ['dead','Deadlift']];
  let challengeUrl = '';
  function readLifter(prefix){
    const unit = Settings.get('unit');
    const get = k => {
      const r = readNum($('#cmp-' + prefix + '-' + k), { min:0, max:5000, label:'Lift', required:false });
      return (r.ok && r.value !== null) ? r.value : 0;
    };
    const bw = readNum($('#cmp-' + prefix + '-bw'), { min:20, max:500, label:'Bodyweight' });
    return {
      squat: get('squat'), bench: get('bench'), dead: get('dead'),
      bw: (bw.ok && bw.value !== null) ? bw.value : 0,
      unit: unit
    };
  }
  function render(){
    const a = readLifter('a'), b = readLifter('b');
    const unit = Settings.get('unit');
    const totalA = a.squat + a.bench + a.dead;
    const totalB = b.squat + b.bench + b.dead;
    const aKg = { bw: Units.toKg(a.bw, unit) };
    const bKg = { bw: Units.toKg(b.bw, unit) };
    const wilksA = aKg.bw > 0 ? Scoring.wilks(Units.toKg(totalA, unit), aKg.bw, 'male').score : NaN;
    const wilksB = bKg.bw > 0 ? Scoring.wilks(Units.toKg(totalB, unit), bKg.bw, 'male').score : NaN;

    $('#cmp-a-table').innerHTML = Tables.html(['Lift','Weight (' + unit + ')','× BW'],
      LIFTS.map(pair => {
        const k = pair[0], label = pair[1];
        const ratio = a.bw > 0 ? a[k] / a.bw : NaN;
        return [label, { v: fmt(a[k], 1), raw: a[k].toFixed(1) }, isFinite(ratio) ? fmt(ratio, 2) + '×' : '—'];
      }).concat([['Total', { v: fmt(totalA, 1), raw: totalA.toFixed(1) }, a.bw > 0 ? fmt(totalA/a.bw, 2) + '×' : '—']])
    );
    $('#cmp-b-table').innerHTML = Tables.html(['Lift','Weight (' + unit + ')','× BW'],
      LIFTS.map(pair => {
        const k = pair[0], label = pair[1];
        const ratio = b.bw > 0 ? b[k] / b.bw : NaN;
        return [label, { v: fmt(b[k], 1), raw: b[k].toFixed(1) }, isFinite(ratio) ? fmt(ratio, 2) + '×' : '—'];
      }).concat([['Total', { v: fmt(totalB, 1), raw: totalB.toFixed(1) }, b.bw > 0 ? fmt(totalB/b.bw, 2) + '×' : '—']])
    );

    $('#cmp-card-a').classList.toggle('win', wilksA > wilksB);
    $('#cmp-card-b').classList.toggle('win', wilksB > wilksA);

    const rows = [
      ['Total', { v: fmt(totalA, 1) + ' ' + unit, raw: totalA.toFixed(1) }, { v: fmt(totalB, 1) + ' ' + unit, raw: totalB.toFixed(1) }],
      ['Bodyweight', { v: fmt(a.bw, 1) + ' ' + unit, raw: a.bw.toFixed(1) }, { v: fmt(b.bw, 1) + ' ' + unit, raw: b.bw.toFixed(1) }],
      ['Wilks (male)', { v: isFinite(wilksA) ? fmt(wilksA, 1) : '—', raw: isFinite(wilksA) ? wilksA.toFixed(1) : '' },
                        { v: isFinite(wilksB) ? fmt(wilksB, 1) : '—', raw: isFinite(wilksB) ? wilksB.toFixed(1) : '' }]
    ];
    $('#cmp-table-wrap').innerHTML = Tables.html(['Metric','Lifter A','Lifter B'], rows);

    let summary = '';
    if (wilksA > wilksB) summary = 'Lifter A leads on Wilks.';
    else if (wilksB > wilksA) summary = 'Lifter B leads on Wilks.';
    else summary = 'Wilks scores are tied or unavailable.';
    $('#cmp-summary').textContent = summary + ' Wilks is used as a neutral comparison because it accounts for bodyweight.';
  }
  function init(){
    ['#cmp-a-squat','#cmp-a-bench','#cmp-a-dead','#cmp-a-bw',
     '#cmp-b-squat','#cmp-b-bench','#cmp-b-dead','#cmp-b-bw'].forEach(s =>
      $(s).addEventListener('input', render));
    $('#cmp-share-card').addEventListener('click', async () => {
      const a = readLifter('a'), b = readLifter('b');
      const unit = Settings.get('unit');
      const totalA = a.squat + a.bench + a.dead, totalB = b.squat + b.bench + b.dead;
      await ShareCard.present({
        title: 'Head-to-Head',
        category: 'Lifter A vs Lifter B',
        hero: fmt(totalA, 0) + ' vs ' + fmt(totalB, 0),
        unit: unit + ' total',
        subtitle: 'A: ' + fmt(a.squat,0) + '/' + fmt(a.bench,0) + '/' + fmt(a.dead,0) +
                  ' · B: ' + fmt(b.squat,0) + '/' + fmt(b.bench,0) + '/' + fmt(b.dead,0),
        rows: [
          ['A total', fmt(totalA, 1) + ' ' + unit],
          ['B total', fmt(totalB, 1) + ' ' + unit],
          ['A Wilks', isFinite(a.bw) && a.bw > 0 ? fmt(Scoring.wilks(Units.toKg(totalA, unit), Units.toKg(a.bw, unit), 'male').score, 1) : '—'],
          ['B Wilks', isFinite(b.bw) && b.bw > 0 ? fmt(Scoring.wilks(Units.toKg(totalB, unit), Units.toKg(b.bw, unit), 'male').score, 1) : '—']
        ],
        filename: 'head-to-head'
      });
    });
    $('#cmp-challenge').addEventListener('click', () => {
      const a = readLifter('a');
      challengeUrl = Share.build('compare', {
        ca: '1', sa: a.squat, ba: a.bench, da: a.dead, bwa: a.bw
      });
      $('#cmp-error').textContent = '';
      toast('Challenge link generated — use Copy link');
    });
    $('#cmp-copy-challenge').addEventListener('click', async () => {
      if (!challengeUrl){
        const a = readLifter('a');
        challengeUrl = Share.build('compare', { ca: '1', sa: a.squat, ba: a.bench, da: a.dead, bwa: a.bw });
      }
      const ok = await copyText(challengeUrl);
      toast(ok ? 'Challenge link copied' : 'Copy failed: ' + challengeUrl);
    });
    render();
  }
  function fromUrl(params){
    if (params.ca === '1'){
      if (params.sa !== undefined) $('#cmp-a-squat').value = params.sa;
      if (params.ba !== undefined) $('#cmp-a-bench').value = params.ba;
      if (params.da !== undefined) $('#cmp-a-dead').value = params.da;
      if (params.bwa !== undefined) $('#cmp-a-bw').value = params.bwa;
      render();
      toast('Challenge loaded — enter your numbers as Lifter B', 3000);
    }
  }
  registerRenderer(render);
  return { init, render, fromUrl };
})();

const PanelGame = (function(){
  let streak = 0, best = 0, round = null;
  let lastGameUnit = null;
  const STREAK_KEY = 'orm_game_streak_v1';
  function loadStreak(){
    try {
      const raw = localStorage.getItem(STREAK_KEY);
      if (raw){ const p = JSON.parse(raw); streak = p.streak || 0; best = p.best || 0; }
    } catch (e){}
  }
  function saveStreak(){
    try { localStorage.setItem(STREAK_KEY, JSON.stringify({ streak, best })); } catch (e){}
  }
  function shuffle(a){
    const arr = a.slice();
    for (let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  function newRound(){
    const unit = Settings.get('unit');
    const denoms = PlateMath.DENOMINATIONS[unit];
    const bar = PlateMath.BARS[unit][0];
    const n = 3 + Math.floor(Math.random() * 4);
    const plates = [];
    for (let i = 0; i < n; i++) plates.push(denoms[Math.floor(Math.random() * denoms.length)]);
    plates.sort((a,b) => b - a);
    const perSide = plates.reduce((a,b) => a + b, 0);
    const total = bar + perSide * 2;
    const opts = new Set([total]);
    let guard = 0;
    while (opts.size < 4 && guard++ < 200){
      const delta = (Math.random() < 0.5 ? -1 : 1) * (denoms[Math.floor(Math.random() * denoms.length)]);
      const v = Math.round((total + delta * 2) * 100) / 100;
      if (v > 0 && v !== total) opts.add(v);
    }
    round = { plates, bar, total, unit, options: shuffle(Array.from(opts)), answered: false };
    lastGameUnit = unit;
    renderRound();
  }
  function renderRound(){
    if (!round) return;
    $('#game-prompt').textContent = 'What is the total weight on the bar? (bar = ' + round.bar + ' ' + round.unit + ')';
    const maxW = Math.max.apply(null, round.plates);
    const colors = ['#a03a2a','#3a352e','#5a6a7a','#4a6b5a','#a08040','#5a4a6a','#5a5a5a'];
    const denoms = PlateMath.DENOMINATIONS[round.unit];
    let html = '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<div style="display:flex;align-items:center;gap:2px;">';
    round.plates.forEach(w => { html += plateDiv(w, maxW, colors, denoms); });
    html += '</div>';
    html += '<div style="height:12px;width:90px;background:#8a8378;border-radius:2px;"></div>';
    html += '<div style="display:flex;align-items:center;gap:2px;flex-direction:row-reverse;">';
    round.plates.forEach(w => { html += plateDiv(w, maxW, colors, denoms); });
    html += '</div></div>';
    $('#game-barbell').innerHTML = html;
    $('#game-options').innerHTML = round.options.map(v =>
      '<button class="game-option" data-val="' + v + '">' + fmt(v, 1) + ' ' + round.unit + '</button>'
    ).join('');
    $$('#game-options .game-option').forEach(btn => {
      btn.addEventListener('click', () => answer(Number(btn.dataset.val)));
    });
    $('#game-result').textContent = '';
    $('#game-streak').textContent = String(streak);
    $('#game-best').textContent = String(best);
  }
  function plateDiv(w, maxW, colors, denoms){
    const rel = maxW > 0 ? w / maxW : 1;
    const height = Math.round(46 + rel * 74);
    const idx = denoms.indexOf(w);
    const color = colors[(idx >= 0 ? idx : 3) % colors.length];
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
      '<div class="plate" style="height:' + height + 'px;background:' + color + ';"></div>' +
      '<div style="font-size:9px;color:#6e665c;margin-top:2px;">' + esc(w) + '</div></div>';
  }
  function answer(v){
    if (!round || round.answered) return;
    round.answered = true;
    const correct = Math.abs(v - round.total) < 1e-6;
    if (correct){
      streak++;
      if (streak > best) best = streak;
      $('#game-result').textContent = 'Correct. Streak: ' + streak;
    } else {
      streak = 0;
      $('#game-result').textContent = 'Wrong. The total was ' + fmt(round.total, 1) + ' ' + round.unit + '.';
    }
    saveStreak();
    $('#game-streak').textContent = String(streak);
    $('#game-best').textContent = String(best);
    $$('#game-options .game-option').forEach(btn => {
      const val = Number(btn.dataset.val);
      if (Math.abs(val - round.total) < 1e-6) btn.classList.add('correct');
      else if (Math.abs(val - v) < 1e-6) btn.classList.add('wrong');
      btn.disabled = true;
    });
    setTimeout(() => { if (round && round.answered) newRound(); }, 1400);
  }
  function init(){
    loadStreak();
    $('#game-new').addEventListener('click', newRound);
    $('#game-reset').addEventListener('click', () => { streak = 0; saveStreak(); renderRound(); });
    $('#game-share').addEventListener('click', async () => {
      await ShareCard.present({
        title: 'Guess the Plates',
        category: 'Streak',
        hero: String(streak),
        unit: 'in a row',
        subtitle: 'Best streak: ' + best + ' · ' + Settings.get('unit') + ' plates',
        rows: [['Current streak', streak], ['Personal best', best]],
        filename: 'plate-game'
      });
    });
    document.addEventListener('settings:change', () => {
      const cur = Settings.get('unit');
      if (cur === lastGameUnit) return;
      newRound();
    });
    newRound();
  }
  registerRenderer(() => {});
  return { init, render: () => {} };
})();

const PanelSettings = (function(){
  function render(){
    $('#se-unit').value = Settings.get('unit');
    fillRoundingSelect($('#se-round'), Settings.get('rounding'));
    Formulas.populateSelect($('#se-formula'), { consensus:false, value: Settings.get('formula') });
    $('#se-maxreps').value = String(Settings.get('maxReps'));
    $('#se-decimals').value = String(Settings.get('decimals'));
    const prefsSize = (localStorage.getItem(Settings.KEY) || '').length;
    const histRaw = localStorage.getItem(Tracker.KEY);
    let histCount = 0;
    try {
      const parsed = histRaw ? JSON.parse(histRaw) : null;
      histCount = parsed && parsed.records ? parsed.records.length : 0;
    } catch (e){ histCount = 0; }
    $('#se-storage-wrap').innerHTML = Tables.html(
      ['Storage key','Contents','Size'],
      [
        ['orm_settings_v2','Calculator preferences', prefsSize + ' bytes'],
        ['orm_history_v2', histCount + ' training record' + (histCount === 1 ? '' : 's'), (histRaw || '').length + ' bytes'],
        ['orm_standards_v2','Custom strength-standards dataset', (localStorage.getItem(Standards.KEY) || 'not set').length + ' bytes'],
        ['orm_inventory_v1','Plate inventories (kg & lb)', (localStorage.getItem('orm_inventory_v1') || 'not set').length + ' bytes']
      ]
    );
  }
  function init(){
    $('#se-save').addEventListener('click', () => {
      const mr = readNum($('#se-maxreps'), { min:1, max:36, label:'Repetition limit', integer:true });
      const dp = readNum($('#se-decimals'), { min:0, max:4, label:'Decimal places', integer:true });
      if (!mr.ok || !dp.ok){ $('#se-msg').className = 'error'; $('#se-msg').textContent = !mr.ok ? mr.msg : dp.msg; return; }
      Settings.set('unit', $('#se-unit').value);
      Settings.set('rounding', Number($('#se-round').value));
      Settings.set('formula', $('#se-formula').value);
      Settings.set('maxReps', mr.value);
      Settings.set('decimals', dp.value);
      $('#se-msg').className = 'ok'; $('#se-msg').textContent = 'Settings saved.';
      toast('Saved'); renderAll();
    });
    $('#se-reset').addEventListener('click', () => {
      Settings.reset();
      $('#globalUnit').value = Settings.get('unit');
      updateUnitLabels(); render(); renderAll();
      $('#se-msg').className = 'ok'; $('#se-msg').textContent = 'Settings reset.';
    });
    $('#se-clear-prefs').addEventListener('click', () => {
      if (!confirm('Clear stored preferences? Training history is kept.')) return;
      try { localStorage.removeItem(Settings.KEY); } catch (e){}
      Settings.load(); Settings.reset();
      $('#globalUnit').value = Settings.get('unit');
      updateUnitLabels(); render(); renderAll();
      toast('Preferences cleared');
    });
    $('#se-run-tests').addEventListener('click', () => {
      const out = runSelfTests();
      if (out.failed.length) toast(out.failed.length + ' of ' + out.results.length + ' self-tests failed — see console', 4000);
      else toast('All ' + out.results.length + ' self-tests passed');
      console.table(out.results);
    });
    const hc = $('#set-hc');
    if (hc){
      hc.checked = !!localStorage.getItem('orm_hc');
      document.documentElement.classList.toggle('hc', hc.checked);
      hc.addEventListener('change', () => {
        document.documentElement.classList.toggle('hc', hc.checked);
        try { localStorage.setItem('orm_hc', hc.checked ? '1' : ''); } catch (e){}
      });
    }
    render();
  }
  registerRenderer(render);
  return { init, render };
})();

function updateUnitLabels(){
  const unit = Settings.get('unit');
  $$('.u').forEach(el => { el.textContent = unit; });
}

function initGlobalTableActions(){
  $$('[data-copy-table]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rows = Tables.rowsFrom(btn.dataset.copyTable);
      if (!rows.length){ toast('Nothing to copy'); return; }
      const ok = await copyText(Tables.toCSV(rows).replace(/,/g, '\t'));
      toast(ok ? 'Table copied' : 'Copy failed');
    });
  });
  $$('[data-csv-table]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rows = Tables.rowsFrom(btn.dataset.csvTable);
      if (!rows.length){ toast('Nothing to export'); return; }
      downloadFile(btn.dataset.filename || 'export.csv', Tables.toCSV(rows));
      toast('CSV exported');
    });
  });
}

function runSelfTests(){
  const results = [];
  function check(name, actual, expected, tol){
    const t = tol === undefined ? 1e-6 : tol;
    const pass = isFinite(actual) && Math.abs(actual - expected) <= t;
    results.push({ name, actual, expected, pass });
  }
  function checkNaN(name, actual){
    results.push({ name, actual: String(actual), expected: 'NaN', pass: Number.isNaN(actual) });
  }
  Formulas.all().forEach(f => {
    check(f.name + ' @ 1 rep returns weight', Formulas.calc(f.id, 100, 1), 100, 1e-9);
  });
  check('Epley 100x5',    Formulas.calc('epley', 100, 5),    116.6666667, 1e-4);
  check('Brzycki 100x5',  Formulas.calc('brzycki', 100, 5),  112.5,       1e-9);
  check("O'Conner 100x5", Formulas.calc('oconner', 100, 5),  112.5,       1e-9);
  checkNaN('Brzycki @ 40 reps guarded', Formulas.calc('brzycki', 100, 40));
  checkNaN('Epley @ 20 reps (over hardMax 12) guarded', Formulas.calc('epley', 100, 20));
  const rm = Formulas.repMax('epley', 120, 8);
  check('Epley rep-max inversion round trip', Formulas.calc('epley', rm, 8), 120, 1e-6);
  check('kg to lb to kg round trip', Units.convert(Units.convert(50, 'kg', 'lb'), 'lb', 'kg'), 50, 1e-9);
  const inv = PlateMath.DENOMINATIONS.kg.map(w => ({ w, count: PlateMath.DEFAULT_COUNTS.kg[w] || 0 }));
  let worstExcess = 0;
  [20, 40, 60, 80, 100, 120, 137.5, 150, 180, 200, 220, 250].forEach(t => {
    const s = PlateMath.solve(t, 20, inv);
    if (s && isFinite(s.total) && s.total > t) worstExcess = Math.max(worstExcess, s.total - t);
  });
  check('Plate solver never exceeds any target', worstExcess, 0, 1e-9);
  const oor = PlateMath.solve(5000, 20, inv);
  results.push({ name:'Plate solver signals out-of-range', actual: oor.reason, expected:'out-of-range', pass: oor.reason === 'out-of-range' });
  checkNaN('Negative weight yields NaN', Formulas.calc('epley', -10, 5));
  check('Percent for 1 rep = 100', Formulas.percentForReps('epley', 1), 100, 1e-9);
  const w = Scoring.wilks(600, 80, 'male');
  results.push({ name:'Wilks 600kg @ 80kg male ≈ 491.48 (2020 coefficients)', actual: w.score, expected:'489–494', pass: w.score > 489 && w.score < 494 });
  const d = Scoring.dots(600, 80, 'male');
  results.push({ name:'DOTS 600kg @ 80kg male ≈ 413.73', actual: d.score, expected:'411–416', pass: d.score > 411 && d.score < 416 });
  const totalFor400 = Scoring.totalForScore('wilks', 400, 80, 'male');
  const back = Scoring.wilks(totalFor400, 80, 'male').score;
  check('Wilks reverse round-trip 400pts', back, 400, 1);
  results.push({ name:'validISO accepts 2024-06-15', actual: validISO('2024-06-15'), expected: true, pass: validISO('2024-06-15') });
  results.push({ name:'validISO rejects 2024-13-45', actual: validISO('2024-13-45'), expected: false, pass: !validISO('2024-13-45') });
  results.push({ name:'validISO rejects empty', actual: validISO(''), expected: false, pass: !validISO('') });
  const csvRows = [['a','b','c'],['1','two','3,4'],['x"y','z','']];
  const csvText = Tables.toCSV(csvRows);
  const parsed = Tables.parseCSV(csvText);
  results.push({ name:'CSV round-trip preserves structure', actual: JSON.stringify(parsed), expected: JSON.stringify(csvRows),
                 pass: JSON.stringify(parsed) === JSON.stringify(csvRows) });
  const kg100 = Units.toKg(100, 'kg');
  const lb100 = Units.fromKg(kg100, 'lb');
  check('kg to lb preserves physical weight', Units.toKg(lb100, 'lb'), 100, 1e-6);
  const progRows = Programs.generate('lp', { squat:0, bench:120, dead:0, press:0 }, 1, 'kg');
  const flat = progRows[0].days.flatMap(d => d.sets);
  const hasNaN = flat.some(s => typeof s.weight === 'number' && !isFinite(s.weight));
  results.push({ name:'Program generator never emits NaN', actual: hasNaN, expected: false, pass: !hasNaN });
  const emptyTM = Programs.generate('lp', { squat:0, bench:0, dead:0, press:0 }, 1, 'kg');
  results.push({ name:'Program generator returns dash for zero TM', actual: emptyTM[0].days[0].sets[0].weight, expected:'—', pass: emptyTM[0].days[0].sets[0].weight === '—' });
  check('RPE 1 rep @ RPE 10 = 100%', RPE.percentFor(1, 10), 1.0, 1e-9);
  check('RPE 5 reps @ RPE 8 = 80.3%', RPE.percentFor(5, 8), 0.803, 1e-9);
  const rpeRes = RPE.e1rm(100, 5, 8);
  check('RPE e1RM 100x5 @ RPE8', rpeRes, 100 / 0.803, 1e-9);
  const failed = results.filter(r => !r.pass);
  return { results, failed };
}

(function installManifest(){
  try {
    const iconSvg = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#a83b1e"/><rect x="12" y="44" width="76" height="12" rx="3" fill="#f5e3da"/><rect x="20" y="26" width="13" height="48" rx="4" fill="#f5e3da"/><rect x="67" y="26" width="13" height="48" rx="4" fill="#f5e3da"/></svg>');
    const manifest = {
      name: 'One Rep Max & Strength Calculators',
      short_name: 'ORM Calc',
      description: 'Strength-training calculators. No account. Your data stays on your device.',
      start_url: '.',
      display: 'standalone',
      background_color: '#f3f0ea',
      theme_color: '#a83b1e',
      icons: [
        { src: iconSvg, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: iconSvg, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
      ]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = url;
    document.head.appendChild(link);
  } catch (e){ /* non-fatal */ }
})();

(function boot(){
  Settings.load();
  Standards.load();
  Tracker.load();
  StorageHealth.updateBadge();

  $('#globalUnit').value = Settings.get('unit');
  updateUnitLabels();
  Tabs.init();

  Panel1RM.init();
  PanelRepMax.init();
  PanelPercent.init();
  PanelTM.init();
  PanelPlate.init();
  PanelWarmup.init();
  PanelConvert.init();
  PanelScore.init();
  PanelStandards.init();
  PanelRatio.init();
  PanelImbalance.init();
  PanelProgram.init();
  PanelBulk.init();
  PanelTracker.init();
  PanelBadges.init();
  PanelAttempts.init();
  PanelCompare.init();
  PanelGame.init();
  PanelSettings.init();

  initGlobalTableActions();

  const hash = Share.read();
  if (hash.w || hash.r || hash.e || hash.f) Panel1RM.fromUrl(hash);
  if (hash.ca === '1') PanelCompare.fromUrl(hash);

  let lastUnit = Settings.get('unit');

  $('#globalUnit').addEventListener('change', () => {
    Settings.set('unit', $('#globalUnit').value);
  });

  document.addEventListener('settings:change', (e) => {
    const curUnit = Settings.get('unit');
    if (curUnit !== lastUnit){
      runUnitConverters(lastUnit, curUnit);
      convertWeightInputs(lastUnit, curUnit);
      lastUnit = curUnit;
    }
    updateUnitLabels();
    if ($('#globalUnit').value !== curUnit){
      $('#globalUnit').value = curUnit;
    }
    if (e.detail && (e.detail.key === 'unit' || e.detail.reset)){
      ['#pc-round','#tm-round','#wu-round','#at-increment','#at-round','#se-round']
        .forEach(sel => { if ($(sel)) fillRoundingSelect($(sel), Settings.get('rounding')); });
    }
    PanelSettings.render();
    renderAll();
  });

  if (new URLSearchParams(location.search).has('selftest')){
    const out = runSelfTests();
    console[out.failed.length ? 'error' : 'log'](
      '%c' + (out.results.length - out.failed.length) + '/' + out.results.length + ' calculation self-tests passed',
      'color:' + (out.failed.length ? 'red' : 'green')
    );
    if (out.failed.length) console.table(out.failed);
  }

  window.ORMCalc = {
    Formulas, RPE, Units, PlateMath, Scoring, Standards, Tables, PDFExport,
    Archetype, Badges, Animals, Programs, ShareCard,
    selfTest: runSelfTests
  };

  renderAll();
  updateUnitLabels();
})();

/* ===== app script block 2 (order preserved) ===== */

(function(){
  'use strict';
  const unit = () => Settings.get('unit');
  const num = el => { const v = parseFloat(el.value); return isFinite(v) ? v : NaN; };
  const roundTo = (v, inc) => (inc > 0 ? Math.round(v / inc) * inc : v);
  function pctOf1RM(totalReps){ return totalReps <= 1 ? 1 : 1 / (1 + totalReps / 30); }
  function refreshUnits(){ $$('.u').forEach(el => el.textContent = unit()); }
  function safeStore(key, val){ try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch (e){ return null; } }

  const GROUPS = {
    calc: ['profile','1rm','repmax','percent','tm','plate','warmup','convert','loader','velocity','timer','selftest'],
    plan: ['profile','builder','program','bulk','readiness','fatigue','warmup','loader','timer'],
    track: ['profile','log','goal','tracker','badges','forecast','ratio','imbalance','weak','data'],
    compete: ['profile','score','standards','percentile','planner','attempts','compare','meet','game']
  };
  function setGroup(g){
    $$('.group-btn[data-group]').forEach(b => b.classList.toggle('active', b.dataset.group === g));
    $$('#tabs .tab-btn').forEach(b => {
      const id = b.dataset.tab;
      b.hidden = !(g === 'all' || id === 'settings' || (GROUPS[g] || []).indexOf(id) >= 0);
    });
    safeStore('orm_section', g);
  }
  $$('.group-btn[data-group]').forEach(b => b.addEventListener('click', () => {
    setGroup(b.dataset.group);
    const first = $$('#tabs .tab-btn').find(x => !x.hidden);
    if (first && $('#tabs .tab-btn.active') && $('#tabs .tab-btn.active').hidden) Tabs.show(first.dataset.tab);
  }));
  setGroup(safeStore('orm_section') || 'all');

  $$('#tabs .tab-btn').forEach(b => b.setAttribute('tabindex', b.classList.contains('active') ? '0' : '-1'));
  document.addEventListener('tab:change', () => {
    $$('#tabs .tab-btn').forEach(b => b.setAttribute('tabindex', b.classList.contains('active') ? '0' : '-1'));
  });
  $('#tabs').addEventListener('keydown', e => {
    const vis = $$('#tabs .tab-btn').filter(b => !b.hidden);
    const i = vis.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % vis.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + vis.length) % vis.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = vis.length - 1;
    if (n === null) return;
    e.preventDefault();
    vis[n].focus(); Tabs.show(vis[n].dataset.tab);
  });

  const root = document.documentElement;
  const savedTheme = safeStore('orm_theme');
  if (savedTheme) root.setAttribute('data-theme', savedTheme);
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) root.setAttribute('data-theme', 'dark');
  $('#theme-toggle').addEventListener('click', () => {
    const isDark = root.getAttribute('data-theme') === 'dark' ||
      (!root.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', next); safeStore('orm_theme', next);
  });

  const HI = {
    g_all:'सभी', g_calc:'गणना', g_plan:'योजना', g_track:'ट्रैक', g_compete:'प्रतियोगिता',
    '1rm':'1RM', repmax:'रेप मैक्स', percent:'%', tm:'ट्रेनिंग मैक्स', plate:'प्लेट्स', warmup:'वार्म-अप',
    convert:'बदलें', score:'स्कोरिंग', standards:'मानक', ratio:'BW अनुपात', imbalance:'आर्केटाइप',
    program:'प्रोग्राम', bulk:'बल्क', tracker:'ट्रैकर', badges:'बैज', attempts:'अटेम्प्ट्स', compare:'तुलना',
    game:'प्लेट गेम', settings:'सेटिंग्स', readiness:'तैयारी', velocity:'वेलोसिटी', loader:'स्मार्ट लोडर',
    forecast:'पूर्वानुमान', meet:'मीट डे', data:'डेटा'
  };
  const EN = {};
  $$('[data-i18n]').forEach(el => EN[el.dataset.i18n] = el.textContent);
  $$('#tabs .tab-btn').forEach(b => EN[b.dataset.tab] = b.firstChild.textContent);
  function applyLang(lang){
    const dict = lang === 'hi' ? HI : EN;
    $$('[data-i18n]').forEach(el => { const t = dict[el.dataset.i18n]; if (t) el.textContent = t; });
    $$('#tabs .tab-btn').forEach(b => { const t = dict[b.dataset.tab]; if (t) b.firstChild.textContent = t; });
    root.lang = lang; safeStore('orm_lang', lang);
  }
  if (safeStore('orm_lang') === 'hi') safeStore('orm_lang', 'en');
  $('#lang-select').value = safeStore('orm_lang') || 'en';
  $('#lang-select').addEventListener('change', e => applyLang(e.target.value));
  applyLang($('#lang-select').value);

  function renderReadiness(){
    ['sleep','stress','sore'].forEach(k => $('#rd-' + k + '-o').textContent = $('#rd-' + k).value);
    const w = num($('#rd-weight')), r = parseInt($('#rd-reps').value, 10), rpe = parseFloat($('#rd-rpe').value);
    const inc = num($('#rd-round')) || 2.5, err = $('#rd-error');
    if (!(w > 0) || !(r >= 1 && r <= 12)){ err.textContent = 'Enter a weight above 0 and 1–12 reps.'; $('#rd-result').textContent = '—'; $('#rd-table-wrap').textContent = ''; return; }
    err.textContent = '';
    const rir = 10 - rpe;
    const e1 = w / pctOf1RM(r + rir);
    const score = (+$('#rd-sleep').value + +$('#rd-stress').value + +$('#rd-sore').value);
    const factor = 0.92 + (score - 3) / 12 * 0.12;
    const today = e1 * factor;
    $('#rd-result').textContent = fmt(roundTo(today, inc)) + ' ' + unit();
    $('#rd-summary').textContent = 'Estimated 1RM ' + fmt(e1) + ' ' + unit() + ' · readiness ' + Math.round(factor * 100) + '% (' +
      (factor < 0.97 ? 'go lighter today' : factor > 1.01 ? 'good day — push a little' : 'normal day') + ')';
    $('#rd-meter').style.width = Math.round((score - 3) / 12 * 100) + '%';
    const targets = [[1,9],[1,8],[3,8],[5,8],[5,7],[8,7]];
    $('#rd-table-wrap').innerHTML = Tables.html(['Target','Weight (' + unit() + ')','% of today'],
      targets.map(([reps, t]) => { const v = today * pctOf1RM(reps + (10 - t)); return [reps + ' @ RPE ' + t, fmt(roundTo(v, inc)), Math.round(v / today * 100) + '%']; }));
  }
  $$('#panel-readiness input, #panel-readiness select').forEach(el => el.addEventListener('input', renderReadiness));

  let veRows = safeStore('orm_velocity') || [{ w:60, v:0.95 }, { w:80, v:0.70 }];
  function drawVeRows(){
    $('#ve-rows').innerHTML = veRows.map((r, i) =>
      '<div class="row tight" style="align-items:end;margin-bottom:.3rem;">' +
      '<label style="flex:1;margin:0;">Load<input type="number" step="0.5" min="0" data-i="' + i + '" data-k="w" value="' + esc(r.w) + '"></label>' +
      '<label style="flex:1;margin:0;">m/s<input type="number" step="0.01" min="0" data-i="' + i + '" data-k="v" value="' + esc(r.v) + '"></label>' +
      '<button data-del="' + i + '" aria-label="Remove set">×</button></div>').join('');
  }
  function renderVelocity(){
    const lift = $('#ve-lift').value;
    const mvt = num($('#ve-mvt')), err = $('#ve-error');
    const pts = veRows.filter(r => r.w > 0 && r.v > 0);
    if (pts.length < 2 || !(mvt > 0)){ err.textContent = 'Enter at least 2 sets with load and speed.'; $('#ve-result').textContent = '—'; $('#ve-chart').textContent = ''; return; }
    const n = pts.length, mx = pts.reduce((a,p)=>a+p.w,0)/n, my = pts.reduce((a,p)=>a+p.v,0)/n;
    let sxy = 0, sxx = 0, syy = 0;
    pts.forEach(p => { sxy += (p.w-mx)*(p.v-my); sxx += (p.w-mx)**2; syy += (p.v-my)**2; });
    if (sxx === 0){ err.textContent = 'Use at least two different weights.'; return; }
    const m = sxy / sxx, b = my - m * mx;
    if (m >= 0){ err.textContent = 'Speed should drop as weight goes up — check your numbers.'; $('#ve-result').textContent = '—'; return; }
    err.textContent = '';
    const e1 = (mvt - b) / m, r2 = syy ? (sxy*sxy)/(sxx*syy) : 0;
    $('#ve-result').textContent = fmt(e1) + ' ' + unit();
    $('#ve-summary').textContent = 'Fit quality R² = ' + r2.toFixed(3) + (r2 < 0.9 ? ' (low — add more sets)' : ' (good)') +
      ' · speed lost per ' + unit() + ': ' + Math.abs(m).toFixed(4) + ' m/s';
    const rows = [0.5,0.6,0.7,0.8,0.9].map(p => { const load = e1 * p; return [Math.round(p*100) + '%', fmt(load), (m*load + b).toFixed(2)]; });
    $('#ve-chart').innerHTML = Tables.html(['% 1RM','Load (' + unit() + ')','Expected m/s'], rows);
    safeStore('orm_velocity', veRows);
    if (lift !== 'custom') $('#ve-mvt').value = lift;
  }
  $('#ve-lift').addEventListener('change', () => { if ($('#ve-lift').value !== 'custom') $('#ve-mvt').value = $('#ve-lift').value; renderVelocity(); });
  $('#ve-mvt').addEventListener('input', () => { $('#ve-lift').value = 'custom'; renderVelocity(); });
  $('#ve-rows').addEventListener('input', e => { const i = +e.target.dataset.i, k = e.target.dataset.k; if (k){ veRows[i][k] = parseFloat(e.target.value); renderVelocity(); } });
  $('#ve-rows').addEventListener('click', e => { if (e.target.dataset.del !== undefined){ veRows.splice(+e.target.dataset.del, 1); drawVeRows(); renderVelocity(); } });
  $('#ve-add').addEventListener('click', () => { veRows.push({ w:0, v:0 }); drawVeRows(); });
  $('#ve-demo').addEventListener('click', () => { veRows = [{w:60,v:1.0},{w:80,v:0.78},{w:100,v:0.55},{w:115,v:0.38}]; drawVeRows(); renderVelocity(); });

  const PLATE_SETS = {
    kg: [25,20,15,10,5,2.5,1.25,0.5,0.25],
    lb: [45,35,25,10,5,2.5],
    mixed: [25,20,20.41,15,11.34,10,5,4.54,2.5,2.27,1.25,1.13]
  };
  const KG_COLORS = { 25:['#a03a2a','#fff'], 20:['#3a5a7a','#fff'], 15:['#d4b050','#1c1a17'], 10:['#3a6a4a','#fff'], 5:['#e0dbd0','#1c1a17'], 2.5:['#2a2622','#fff'], 1.25:['#b8b0a4','#1c1a17'], 0.5:['#b8b0a4','#1c1a17'], 0.25:['#b8b0a4','#1c1a17'] };
  function chip(p, set){
    const c = (set === 'kg' && KG_COLORS[p]) ? KG_COLORS[p] : ['var(--accent-2)','var(--fg)'];
    return '<span class="plate-chip" style="background:' + c[0] + ';color:' + c[1] + ';">' + fmt(p, 2) + '</span>';
  }
  function greedy(perSide, plates){
    const out = []; let rem = perSide + 1e-9;
    plates.forEach(p => { while (rem >= p - 1e-9){ out.push(p); rem -= p; } });
    return { plates: out, left: rem };
  }
  function changes(a, b){ let k = 0; while (k < a.length && k < b.length && Math.abs(a[k] - b[k]) < 1e-9) k++; return (a.length - k) + (b.length - k); }
  function loadPlan(top, pcts, bar, collar, setKey, optimise){
    const plates = PLATE_SETS[setKey];
    const rows = []; let prev = [];
    pcts.forEach(pc => {
      const step = setKey === 'lb' ? 10 : 5;
      const raw = top * pc / 100;
      const target = Math.max(bar, pc >= 100 ? raw : Math.round(raw / step) * step);
      const per = (target - bar) / 2 - (target > bar ? collar : 0);
      let sol = greedy(Math.max(per, 0), plates);
      if (optimise && prev.length){
        const prevSum = prev.reduce((a,b)=>a+b,0);
        if (per >= prevSum - 1e-9){
          const add = greedy(per - prevSum, plates.filter(p => p <= prev[prev.length-1] + 1e-9));
          const alt = prev.concat(add.plates);
          if (add.left <= sol.left + 1e-9 && changes(prev, alt) <= changes(prev, sol.plates)) sol = { plates: alt, left: add.left };
        }
      }
      const loaded = bar + (sol.plates.length || per > 0 ? 2 * (sol.plates.reduce((a,b)=>a+b,0) + (target > bar ? collar : 0)) : 0);
      rows.push({ pc, target, plates: sol.plates, loaded, ch: changes(prev, sol.plates) });
      prev = sol.plates;
    });
    return rows;
  }
  function renderLoader(){
    const top = num($('#ld-top')), bar = num($('#ld-bar')), collar = num($('#ld-collar')) || 0, err = $('#ld-error');
    const pcts = $('#ld-pcts').value.split(',').map(x => parseFloat(x)).filter(x => isFinite(x) && x >= 0 && x <= 110);
    if (!(top > 0) || !(bar >= 0) || !pcts.length){ err.textContent = 'Enter a top weight, bar weight and at least one percentage.'; return; }
    err.textContent = '';
    const setKey = $('#ld-set').value;
    const rows = loadPlan(top, pcts, bar, collar, setKey, $('#ld-optimise').checked);
    const totalCh = rows.reduce((a,r)=>a+r.ch,0);
    $('#ld-summary').textContent = rows.length + ' sets · ' + totalCh + ' plate moves per side';
    let h = '<table class="data-table"><thead><tr><th>%</th><th>Target</th><th>Loaded</th><th>Per side</th><th>Moves</th></tr></thead><tbody>';
    rows.forEach(r => { h += '<tr><td>' + r.pc + '%</td><td>' + fmt(r.target) + '</td><td>' + fmt(r.loaded, 2) + '</td><td>' +
      (r.plates.length ? r.plates.map(p => chip(p, setKey)).join('') : '<span class="muted">empty bar</span>') + '</td><td>' + r.ch + '</td></tr>'; });
    $('#ld-table-wrap').innerHTML = h + '</tbody></table>';
  }
  $$('#panel-loader input, #panel-loader select').forEach(el => el.addEventListener('input', renderLoader));
  $('#ld-set').addEventListener('change', () => { const lb = $('#ld-set').value === 'lb'; $('#ld-bar').value = lb ? 45 : 20; $('#ld-collar').value = lb ? 0 : 2.5; renderLoader(); });

  function dailyBest(ex){
    const map = {};
    Tracker.all().filter(r => (r.exercise || '').trim().toLowerCase() === ex).forEach(r => {
      const kg = Units.toKg(r.weight, r.unit || 'kg');
      const e = Formulas.calc('epley', kg, Math.min(r.reps, Formulas.get('epley').hardMax));
      if (isFinite(e) && (!map[r.date] || e > map[r.date])) map[r.date] = e;
    });
    return Object.keys(map).sort().map(d => ({ d: new Date(d + 'T00:00:00'), kg: map[d] }));
  }
  function fillExercises(){
    const names = {}; Tracker.all().forEach(r => { const k = (r.exercise || '').trim(); if (k) names[k.toLowerCase()] = k; });
    const cur = $('#fc-ex').value;
    $('#fc-ex').innerHTML = Object.keys(names).length
      ? Object.keys(names).map(k => '<option value="' + esc(k) + '">' + esc(names[k]) + '</option>').join('')
      : '<option value="">No Tracker entries yet</option>';
    if (cur && names[cur]) $('#fc-ex').value = cur;
  }
  let lastForecast = null;
  function renderForecast(){
    fillExercises();
    const err = $('#fc-error'), pts = dailyBest($('#fc-ex').value);
    lastForecast = null;
    if (pts.length < 3){ err.textContent = 'Add at least 3 days of entries for this exercise in the Tracker.'; $('#fc-result').textContent = '—'; $('#fc-summary').textContent=''; $('#fc-chart').textContent=''; return; }
    err.textContent = '';
    const t0 = pts[0].d.getTime(), DAY = 864e5;
    const xs = pts.map(p => (p.d - t0) / DAY), ys = pts.map(p => p.kg), n = xs.length;
    const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
    let sxy=0,sxx=0; xs.forEach((x,i)=>{ sxy+=(x-mx)*(ys[i]-my); sxx+=(x-mx)**2; });
    const m = sxx ? sxy/sxx : 0, b = my - m*mx;
    const sd = Math.sqrt(ys.reduce((a,y,i)=>a+(y-(m*xs[i]+b))**2,0) / Math.max(n-2,1));
    let target = $('#fc-date').value ? new Date($('#fc-date').value + 'T00:00:00') : new Date(Date.now() + 56*DAY);
    if (!$('#fc-date').value) $('#fc-date').value = target.toISOString().slice(0,10);
    const xt = (target - t0) / DAY, pred = m*xt + b;
    const u = unit(), show = kg => fmt(Units.fromKg(kg, u));
    $('#fc-result').textContent = show(pred) + ' ' + u;
    let s = 'Likely range ' + show(pred - 1.5*sd) + '–' + show(pred + 1.5*sd) + ' ' + u + ' on ' + target.toLocaleDateString() +
      ' · trend ' + (m >= 0 ? '+' : '') + fmt(Units.fromKg(m*30, u)) + ' ' + u + ' per month.';
    const goal = num($('#fc-goal'));
    if (goal > 0){
      const gkg = Units.toKg(goal, u);
      if (m > 0){ const d = new Date(t0 + ((gkg - b)/m) * DAY); s += ' Goal ' + fmt(goal) + ' ' + u + ' expected around ' + d.toLocaleDateString() + '.'; }
      else s += ' At the current trend the goal is not reached — consider changing your program.';
    }
    $('#fc-summary').textContent = s;
    const chartPts = pts.map(p => ({ x: p.d, y: Units.fromKg(p.kg, u) })).concat([{ x: target, y: Units.fromKg(pred, u) }]);
    try { $('#fc-chart').innerHTML = Chart.line(chartPts, { label: 'Estimated 1RM with forecast', height: 220 }); } catch (e){ $('#fc-chart').textContent = ''; }
    lastForecast = { name: $('#fc-ex').selectedOptions[0].textContent, pred: show(pred), u, date: target.toLocaleDateString(), best: show(Math.max.apply(null, ys)) };
  }
  ['#fc-ex','#fc-date','#fc-goal'].forEach(s => $(s).addEventListener('input', renderForecast));
  $('#fc-share').addEventListener('click', async () => {
    if (!lastForecast){ toast('No forecast to share'); return; }
    await ShareCard.present({ title: lastForecast.name + ' forecast', category: 'Projection', hero: lastForecast.pred, unit: lastForecast.u,
      subtitle: 'Expected by ' + lastForecast.date, rows: [['Best so far', lastForecast.best + ' ' + lastForecast.u], ['Forecast', lastForecast.pred + ' ' + lastForecast.u]] });
  });

  const LIFTS = [['sq','Squat'],['bp','Bench press'],['dl','Deadlift']];
  let meet = safeStore('orm_meet') || { sq:[[0,0],[0,0],[0,0]], bp:[[0,0],[0,0],[0,0]], dl:[[0,0],[0,0],[0,0]] };
  function drawMeet(){
    $('#mt-lifts').innerHTML = LIFTS.map(([k, name]) =>
      '<h3>' + name + '</h3><div class="meet-grid">' + meet[k].map((a, i) =>
        '<div><input type="number" step="0.5" min="0" aria-label="' + name + ' attempt ' + (i+1) + '" data-l="' + k + '" data-i="' + i + '" value="' + (a[0] || '') + '" placeholder="Att ' + (i+1) + '">' +
        '<button style="width:100%;margin-top:.2rem;" data-st="' + k + ':' + i + '" class="' + (a[1] === 1 ? 'att-good' : a[1] === 2 ? 'att-bad' : '') + '">' +
        (a[1] === 1 ? 'Good' : a[1] === 2 ? 'No lift' : 'Pending') + '</button></div>').join('') + '</div>').join('');
  }
  function renderMeet(){
    let total = 0, bombed = false;
    LIFTS.forEach(([k]) => { const good = meet[k].filter(a => a[1] === 1).map(a => a[0]); if (good.length) total += Math.max.apply(null, good); else if (meet[k].every(a => a[1] === 2)) bombed = true; });
    const goal = num($('#mt-goal')), u = unit();
    $('#mt-total').textContent = fmt(total) + ' ' + u;
    $('#mt-meter').style.width = goal > 0 ? Math.min(100, total / goal * 100) + '%' : '0%';
    $('#mt-goal-status').textContent = bombed ? 'Bombed out — no successful attempt in one lift.' :
      goal > 0 ? (total >= goal ? 'Goal reached.' : fmt(goal - total) + ' ' + u + ' to goal') : '';
    safeStore('orm_meet', meet);
    return total;
  }
  $('#mt-lifts').addEventListener('input', e => { const l = e.target.dataset.l; if (l){ meet[l][+e.target.dataset.i][0] = parseFloat(e.target.value) || 0; renderMeet(); } });
  $('#mt-lifts').addEventListener('click', e => { const st = e.target.dataset.st; if (!st) return; const [l, i] = st.split(':'); const a = meet[l][+i]; a[1] = (a[1] + 1) % 3; drawMeet(); renderMeet(); });
  $('#mt-goal').addEventListener('input', renderMeet);
  $('#mt-reset').addEventListener('click', () => { if (!confirm('Clear all attempts?')) return; meet = { sq:[[0,0],[0,0],[0,0]], bp:[[0,0],[0,0],[0,0]], dl:[[0,0],[0,0],[0,0]] }; drawMeet(); renderMeet(); });
  $('#mt-share').addEventListener('click', async () => {
    const total = renderMeet(), u = unit();
    const best = k => { const g = meet[k].filter(a => a[1] === 1).map(a => a[0]); return g.length ? fmt(Math.max.apply(null, g)) + ' ' + u : '—'; };
    await ShareCard.present({ title: 'Meet result', category: 'Competition', hero: fmt(total), unit: u, subtitle: 'Total',
      rows: [['Squat', best('sq')], ['Bench', best('bp')], ['Deadlift', best('dl')]] });
  });
  let timerId = null, timerEnd = 0;
  function tick(){
    const left = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
    $('#mt-timer').textContent = Math.floor(left/60) + ':' + String(left%60).padStart(2,'0');
    if (left <= 0){ clearInterval(timerId); timerId = null; toast('Time'); try { navigator.vibrate && navigator.vibrate([200,100,200]); } catch (e){} }
  }
  function startTimer(sec){ clearInterval(timerId); timerEnd = Date.now() + sec*1000; tick(); timerId = setInterval(tick, 250); }
  $('#mt-t60').addEventListener('click', () => startTimer(60));
  $('#mt-t180').addEventListener('click', () => startTimer(180));
  $('#mt-tstop').addEventListener('click', () => { clearInterval(timerId); timerId = null; $('#mt-timer').textContent = '1:00'; });

  function csvCell(v){ v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function parseCSV(text){
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++){
      const c = text[i];
      if (q){ if (c === '"' && text[i+1] === '"'){ cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ','){ row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r'){ if (c === '\r' && text[i+1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length){ row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  $('#dc-export').addEventListener('click', () => {
    const recs = Tracker.all();
    if (!recs.length){ $('#dc-csv-msg').textContent = 'No Tracker entries to export.'; return; }
    const lines = ['date,exercise,weight,unit,reps,notes'].concat(recs.map(r => [r.date, r.exercise, r.weight, r.unit || 'kg', r.reps, r.notes || ''].map(csvCell).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'strength-tracker.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('#dc-csv-msg').textContent = 'Exported ' + recs.length + ' entries.';
  });
  $('#dc-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 2e6){ $('#dc-csv-msg').textContent = 'File too large (max 2 MB).'; return; }
    const rows = parseCSV(await f.text());
    const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
    const idx = k => head.indexOf(k);
    if (idx('date') < 0 || idx('exercise') < 0 || idx('weight') < 0 || idx('reps') < 0){ $('#dc-csv-msg').textContent = 'CSV needs columns: date, exercise, weight, reps (unit, notes optional).'; return; }
    let ok = 0, bad = 0;
    rows.forEach(r => {
      const u = (r[idx('unit')] || 'kg').trim().toLowerCase();
      const rec = Tracker.add({ date: (r[idx('date')] || '').trim(), exercise: String(r[idx('exercise')] || '').slice(0, 80),
        weight: r[idx('weight')], reps: r[idx('reps')], unit: u === 'lb' ? 'lb' : 'kg', notes: idx('notes') >= 0 ? String(r[idx('notes')] || '').slice(0, 300) : '' });
      rec ? ok++ : bad++;
    });
    $('#dc-csv-msg').textContent = 'Imported ' + ok + ' entries' + (bad ? ', skipped ' + bad + ' invalid rows' : '') + '.';
    e.target.value = '';
    try { renderAll(); } catch (er){}
  });

  function fromKgAll(kg, skip){
    const lb = kg / Units.KG_PER_LB;
    if (skip !== 'kg') $('#dc-kg').value = +kg.toFixed(2);
    if (skip !== 'lb') $('#dc-lb').value = +lb.toFixed(2);
    if (skip !== 'st'){ $('#dc-st').value = Math.floor(lb / 14); $('#dc-stlb').value = +(lb % 14).toFixed(1); }
  }
  $('#dc-kg').addEventListener('input', () => { const v = num($('#dc-kg')); if (isFinite(v)) fromKgAll(v, 'kg'); });
  $('#dc-lb').addEventListener('input', () => { const v = num($('#dc-lb')); if (isFinite(v)) fromKgAll(v * Units.KG_PER_LB, 'lb'); });
  ['#dc-st','#dc-stlb'].forEach(s => $(s).addEventListener('input', () => { const lb = (num($('#dc-st')) || 0) * 14 + (num($('#dc-stlb')) || 0); fromKgAll(lb * Units.KG_PER_LB, 'st'); }));
  fromKgAll(100);

// ===== Local QR code encoder — offline replacement for api.qrserver.com =====
// Compact port of Project Nayuki's QR Code generator library (MIT license).
// Byte mode only, ECC level M (falls back to L), versions 1-40, optimal mask choice.
const QRGen = (function(){
  'use strict';
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
  ];
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
  ];
  var MASK_FN = [
    function(x, y){ return (y + x) % 2 === 0; },
    function(x, y){ return y % 2 === 0; },
    function(x, y){ return x % 3 === 0; },
    function(x, y){ return (x + y) % 3 === 0; },
    function(x, y){ return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
    function(x, y){ return (y * x) % 2 + (y * x) % 3 === 0; },
    function(x, y){ return ((y * x) % 2 + (y * x) % 3) % 2 === 0; },
    function(x, y){ return ((y + x) % 2 + (y * x) % 3) % 2 === 0; }
  ];
  function rawModules(ver){
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2){
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver, ecl){
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  }
  function alignPos(ver){
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var r = [6];
    for (var pos = ver * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }
  function gfMul(x, y){
    var z = 0;
    for (var i = 7; i >= 0; i--){
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(deg){
    var r = new Array(deg).fill(0);
    r[deg - 1] = 1;
    var root = 1;
    for (var i = 0; i < deg; i++){
      for (var j = 0; j < deg; j++){
        r[j] = gfMul(r[j], root);
        if (j + 1 < deg) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div){
    var r = div.map(function(){ return 0; });
    data.forEach(function(b){
      var factor = b ^ r.shift();
      r.push(0);
      div.forEach(function(coef, i){ r[i] ^= gfMul(coef, factor); });
    });
    return r;
  }
  function encodeBytes(bytes, ecl){
    var ver = 0;
    for (var v = 1; v <= 40; v++){
      var ccbits = v < 10 ? 8 : 16;
      if (4 + ccbits + bytes.length * 8 <= dataCodewords(v, ecl) * 8){ ver = v; break; }
    }
    if (!ver) throw new Error('Data too long for QR');
    var bb = [];
    function bits(val, len){ for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); }
    bits(4, 4);
    bits(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function(b){ bits(b, 8); });
    var cap = dataCodewords(ver, ecl) * 8;
    bits(0, Math.min(4, cap - bb.length));
    bits(0, (8 - bb.length % 8) % 8);
    for (var pad = 0xEC; bb.length < cap; pad ^= 0xEC ^ 0x11) bits(pad, 8);
    var cw = [];
    for (var i = 0; i < bb.length; i += 8){
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bb[i + j];
      cw.push(b);
    }
    var numBlocks = NUM_BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver];
    var rawCw = Math.floor(rawModules(ver) / 8);
    var numShort = numBlocks - rawCw % numBlocks;
    var shortLen = Math.floor(rawCw / numBlocks);
    var div = rsDivisor(eccLen), blocks = [];
    for (var k = 0, p = 0; k < numBlocks; k++){
      var dat = cw.slice(p, p + shortLen - eccLen + (k < numShort ? 0 : 1));
      p += dat.length;
      var ecc = rsRemainder(dat, div);
      if (k < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (var idx = 0; idx < blocks[0].length; idx++){
      blocks.forEach(function(block, bi){
        if (idx != shortLen - eccLen || bi >= numShort) out.push(block[idx]);
      });
    }
    return { ver: ver, ecl: ecl, codewords: out };
  }
  function buildMatrix(enc){
    var ver = enc.ver, ecl = enc.ecl, size = ver * 4 + 17;
    var modules = [], isFunc = [];
    for (var y0 = 0; y0 < size; y0++){
      modules.push(new Array(size).fill(false));
      isFunc.push(new Array(size).fill(false));
    }
    function set(x, y, dark){ modules[y][x] = dark; isFunc[y][x] = true; }
    function finder(cx, cy){
      for (var dy = -4; dy <= 4; dy++)
        for (var dx = -4; dx <= 4; dx++){
          var x = cx + dx, y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size){
            var d = Math.max(Math.abs(dx), Math.abs(dy));
            set(x, y, d !== 2 && d !== 4);
          }
        }
    }
    function align(cx, cy){
      for (var dy = -2; dy <= 2; dy++)
        for (var dx = -2; dx <= 2; dx++)
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    function drawFormat(mask){
      // spec format indicator: L=01, M=00, Q=11, H=10 (table index 0=L, 1=M)
      var fmtBits = ecl === 0 ? 1 : 0;
      var data = fmtBits << 3 | mask, rem = data, i;
      for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var b = (data << 10 | rem) ^ 0x5412;
      function bit(k){ return (b >>> k) & 1; }
      for (i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    }
    function drawVersion(){
      var rem = ver, i;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var b = ver << 12 | rem;
      for (i = 0; i < 18; i++){
        var bit = (b >>> i) & 1;
        var a = size - 11 + i % 3, c = Math.floor(i / 3);
        set(a, c, bit); set(c, a, bit);
      }
    }
    var i, x, y, j;
    for (i = 0; i < size; i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPos(ver);
    for (i = 0; i < ap.length; i++)
      for (j = 0; j < ap.length; j++)
        if (!((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)))
          align(ap[i], ap[j]);
    drawFormat(0);
    if (ver >= 7) drawVersion();
    var data = enc.codewords, totalBits = data.length * 8, ci = 0;
    for (var right = size - 1; right >= 1; right -= 2){
      if (right === 6) right = 5;
      for (var vt = 0; vt < size; vt++){
        for (var jj = 0; jj < 2; jj++){
          x = right - jj;
          var upward = ((right + 1) & 2) === 0;
          y = upward ? size - 1 - vt : vt;
          if (!isFunc[y][x] && ci < totalBits){
            modules[y][x] = ((data[ci >>> 3] >>> (7 - (ci & 7))) & 1) !== 0;
            ci++;
          }
        }
      }
    }
    function applyMask(m){
      for (y = 0; y < size; y++)
        for (x = 0; x < size; x++)
          if (!isFunc[y][x]) modules[y][x] = modules[y][x] !== MASK_FN[m](x, y);
    }
    function penalty(){
      var result = 0, N1 = 3, N2 = 3, N3 = 40, N4 = 10, xx, yy;
      function addHist(len, hist){
        if (hist[0] === 0) len += size;
        hist.pop(); hist.unshift(len);
      }
      function countPat(hist){
        var n = hist[1];
        var core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
        return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
      }
      for (y = 0; y < size; y++){
        var rc = false, rx = 0, rh = [0,0,0,0,0,0,0];
        for (x = 0; x < size; x++){
          if (modules[y][x] === rc){
            rx++;
            if (rx === 5) result += N1; else if (rx > 5) result++;
          } else {
            addHist(rx, rh);
            if (!rc) result += countPat(rh) * N3;
            rc = modules[y][x]; rx = 1;
          }
        }
        if (rc){ addHist(rx, rh); rx = 0; }
        addHist(rx + size, rh);
        result += countPat(rh) * N3;
      }
      for (x = 0; x < size; x++){
        var rc2 = false, ry = 0, rh2 = [0,0,0,0,0,0,0];
        for (y = 0; y < size; y++){
          if (modules[y][x] === rc2){
            ry++;
            if (ry === 5) result += N1; else if (ry > 5) result++;
          } else {
            addHist(ry, rh2);
            if (!rc2) result += countPat(rh2) * N3;
            rc2 = modules[y][x]; ry = 1;
          }
        }
        if (rc2){ addHist(ry, rh2); ry = 0; }
        addHist(ry + size, rh2);
        result += countPat(rh2) * N3;
      }
      for (yy = 0; yy < size - 1; yy++)
        for (xx = 0; xx < size - 1; xx++){
          var c = modules[yy][xx];
          if (c === modules[yy][xx + 1] && c === modules[yy + 1][xx] && c === modules[yy + 1][xx + 1]) result += N2;
        }
      var dark = 0;
      for (yy = 0; yy < size; yy++)
        for (xx = 0; xx < size; xx++)
          if (modules[yy][xx]) dark++;
      var total = size * size;
      var kk = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      result += kk * N4;
      return result;
    }
    var bestMask = 0, bestPenalty = Infinity, bestModules = null;
    for (var m = 0; m < 8; m++){
      applyMask(m);
      var p = penalty();
      if (p < bestPenalty){ bestPenalty = p; bestMask = m; bestModules = modules.map(function(row){ return row.slice(); }); }
      applyMask(m);
    }
    for (y = 0; y < size; y++) modules[y] = bestModules[y].slice();
    drawFormat(bestMask);
    return { size: size, modules: modules, version: ver, mask: bestMask };
  }
  function make(text){
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(text));
    var enc;
    try { enc = encodeBytes(bytes, 1); }
    catch (e){ enc = encodeBytes(bytes, 0); }
    return buildMatrix(enc);
  }
  function toCanvas(text, px){
    var q = make(text), quiet = 4;
    var scale = Math.max(2, Math.floor(px / (q.size + quiet * 2)));
    var dim = (q.size + quiet * 2) * scale;
    var c = document.createElement('canvas');
    c.width = dim; c.height = dim;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#1c1a17';
    for (var y = 0; y < q.size; y++)
      for (var x = 0; x < q.size; x++)
        if (q.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', 'QR code for the program link');
    return c;
  }
  return { make: make, toCanvas: toCanvas };
})();

  const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g,'+').replace(/_/g,'/'))));
  let coachLink = '';
  $('#dc-make').addEventListener('click', () => {
    const title = $('#dc-title').value.trim().slice(0, 80), prog = $('#dc-prog').value.trim().slice(0, 2000);
    if (!prog){ toast('Write a program first'); return; }
    const url = new URL(location.href); url.hash = 'tab=data'; url.searchParams.set('coach', b64e(JSON.stringify({ t: title, p: prog })));
    coachLink = url.toString();
    $('#dc-link').textContent = coachLink;
    if (coachLink.length > 1800){ $('#dc-qr').innerHTML = '<p class="muted">Program too long for a QR code — share the link instead.</p>'; return; }
    const qrBox = document.createElement('div'); qrBox.className = 'qr-box';
    try { qrBox.appendChild(QRGen.toCanvas(coachLink, 200)); }
    catch (err){ $('#dc-qr').innerHTML = '<p class="muted">Could not generate a QR code — share the link instead.</p>'; return; }
    $('#dc-qr').innerHTML = '';
    $('#dc-qr').appendChild(qrBox);
  });
  $('#dc-copy').addEventListener('click', async () => { if (!coachLink) $('#dc-make').click(); if (coachLink) toast((await copyText(coachLink)) ? 'Link copied' : 'Copy failed'); });
  try {
    const c = new URLSearchParams(location.search).get('coach');
    if (c){
      const d = JSON.parse(b64d(c));
      const box = $('#dc-received'); box.hidden = false;
      box.innerHTML = '<h3>Program from your coach: ' + esc(String(d.t || '').slice(0,80)) + '</h3><pre style="white-space:pre-wrap;margin:0;">' + esc(String(d.p || '').slice(0,2000)) + '</pre>';
      Tabs.show('data', { silent: true });
    }
  } catch (e){ /* ignore malformed links */ }

  function renderPro(){ refreshUnits(); renderReadiness(); renderVelocity(); renderLoader(); renderForecast(); renderMeet(); }
  drawVeRows(); drawMeet();
  try { registerRenderer(renderPro); } catch (e){}
  document.addEventListener('tab:change', e => { if (e.detail && e.detail.id === 'forecast') renderForecast(); });
  renderPro();
})();


/* ===== app script block 3 (order preserved) ===== */

(function(){
  'use strict';
  const U = () => (typeof Settings !== 'undefined' && Settings.get('unit')) || 'kg';
  const LB = 0.45359237;
  const toKg = v => U() === 'lb' ? v * LB : v;
  const fromKg = v => U() === 'lb' ? v / LB : v;
  const $id = id => document.getElementById(id);
  const val = id => { const el = $id(id); if (!el) return NaN; const v = parseFloat(el.value); return isFinite(v) ? v : NaN; };
  const rnd = (v, inc) => inc > 0 ? Math.round(v / inc) * inc : v;
  const fmt = (v, d) => isFinite(v) ? Number(v).toFixed(d == null ? 1 : d).replace(/\.0$/, '') : '—';
  const e = s => (typeof esc === 'function' ? esc(s) : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (err){ return null; } };
  const pct = totalReps => totalReps <= 1 ? 1 : 1 / (1 + totalReps / 30);
  const e1rm = (w, r, rpe) => w / pct(r + ((rpe !== null && rpe !== '' && isFinite(rpe)) ? Math.max(0, 10 - rpe) : 0));
  const table = (head, rows) => '<table><thead><tr>' + head.map(h => '<th>' + e(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const say = (msg) => { if (typeof toast === 'function') toast(msg); };

  function validate(el){
    if (!el || el.type !== 'number') return true;
    let msgEl = el.parentElement && el.parentElement.querySelector(':scope > .field-error');
    const raw = el.value.trim();
    let msg = '';
    if (raw === ''){ if (!el.dataset.optional && el.required) msg = 'Please enter a value.'; }
    else {
      const v = parseFloat(raw);
      const min = el.dataset.min != null ? parseFloat(el.dataset.min) : (el.min !== '' ? parseFloat(el.min) : NaN);
      const max = el.dataset.max != null ? parseFloat(el.dataset.max) : (el.max !== '' ? parseFloat(el.max) : NaN);
      if (!isFinite(v)) msg = 'Enter a number.';
      else if (isFinite(min) && v < min) msg = 'Must be at least ' + min + '.';
      else if (isFinite(max) && v > max) msg = 'Must be ' + max + ' or less.';
      else if (el.step === '1' && Math.round(v) !== v) msg = 'Use a whole number.';
    }
    if (msg){
      el.setAttribute('aria-invalid', 'true');
      if (!msgEl){ msgEl = document.createElement('span'); msgEl.className = 'field-error'; msgEl.setAttribute('role', 'alert'); el.insertAdjacentElement('afterend', msgEl); }
      msgEl.textContent = msg;
      return false;
    }
    el.removeAttribute('aria-invalid');
    if (msgEl) msgEl.remove();
    return true;
  }
  document.addEventListener('input', ev => validate(ev.target), true);
  document.addEventListener('change', ev => validate(ev.target), true);
  const okAll = ids => ids.map(i => validate($id(i))).every(Boolean) && ids.every(i => isFinite(val(i)) || ($id(i) && $id(i).dataset.optional));

  const AUTO = 'orm_autosave';
  function snapshot(){
    const o = {};
    document.querySelectorAll('main input[id], main select[id], .tab-panel input[id], .tab-panel select[id]').forEach(el => {
      if (el.type === 'file' || el.type === 'password') return;
      o[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    });
    return o;
  }
  function restore(o, fire){
    if (!o) return;
    Object.keys(o).forEach(id => {
      const el = $id(id); if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!o[id];
      else if (el.tagName === 'SELECT' && !Array.from(el.options).some(op => op.value === o[id])) return;
      else el.value = o[id];
      if (fire){ el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); }
    });
  }
  let saveT;
  document.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(() => store(AUTO, snapshot()), 400); });
  document.addEventListener('change', () => { clearTimeout(saveT); saveT = setTimeout(() => store(AUTO, snapshot()), 400); });

  let undoBar;
  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('button');
    if (!b || !/(reset|clear)/i.test(b.id || '')) return;
    const before = snapshot();
    setTimeout(() => {
      if (undoBar) undoBar.remove();
      undoBar = document.createElement('div');
      undoBar.className = 'undo-bar'; undoBar.setAttribute('role', 'status');
      undoBar.innerHTML = '<span>Inputs reset.</span><button type="button">Undo</button>';
      document.body.appendChild(undoBar);
      undoBar.querySelector('button').addEventListener('click', () => { restore(before, true); undoBar.remove(); say('Restored'); });
      setTimeout(() => undoBar && undoBar.remove(), 7000);
    }, 0);
  }, true);

  const PF = 'orm_profile';
  function profile(){ return store(PF); }
  function setIf(id, v){ const el = $id(id); if (el && v != null && v !== '' && isFinite(v)){ el.value = Math.round(v * 10) / 10; el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); } }
  function setSel(id, v){ const el = $id(id); if (el && v){ el.value = v; el.dispatchEvent(new Event('change', { bubbles:true })); } }
  function applyProfile(p){
    if (!p) return;
    ['pc-sex','sc-sex'].forEach(i => setSel(i, p.sex));
    ['gl-exp'].forEach(i => setSel(i, p.exp));
    setIf('pc-age', p.age);
    ['sc-bw','pc-bw'].forEach(i => setIf(i, p.bw));
    [['squat','pb-squat'],['squat','wk-squat'],['squat','pc-squat'],['squat','sc-squat'],
     ['bench','pb-bench'],['bench','wk-bench'],['bench','pc-bench'],['bench','sc-bench'],
     ['dead','pb-dead'],['dead','wk-dead'],['dead','pc-dead'],['dead','sc-dead']].forEach(x => setIf(x[1], p[x[0]]));
    if (p.squat && p.bench && p.dead) setIf('sc-total', p.squat + p.bench + p.dead);
    setIf('gl-current', p.squat);
  }
  function loadProfileForm(){
    const p = profile(); if (!p) return;
    ['name','age','bw','squat','bench','dead'].forEach(k => { const el = $id('pf-' + k); if (el && p[k] != null) el.value = p[k]; });
    setSel('pf-sex', p.sex); setSel('pf-exp', p.exp);
  }
  $id('pf-save').addEventListener('click', () => {
    if (!okAll(['pf-age','pf-bw','pf-squat','pf-bench','pf-dead'])){ $id('pf-msg').textContent = 'Please fix the highlighted boxes.'; return; }
    const p = { name: $id('pf-name').value.trim().slice(0, 40), sex: $id('pf-sex').value, exp: $id('pf-exp').value,
      age: val('pf-age'), bw: val('pf-bw'), squat: val('pf-squat'), bench: val('pf-bench'), dead: val('pf-dead') };
    store(PF, p); applyProfile(p); renderAll3();
    $id('pf-msg').textContent = 'Saved. All calculators now use your profile' + (p.name ? ', ' + p.name : '') + '.';
    say('Profile saved');
  });

  const LG = 'orm_log';
  let log = store(LG) || [];
  const saveLog = () => store(LG, log);
  $id('lg-date').value = new Date().toISOString().slice(0, 10);
  function liftSeries(lift){
    const byDay = {};
    log.filter(r => r.lift === lift).forEach(r => { const v = e1rm(r.kg, r.reps, r.rpe); if (!byDay[r.date] || v > byDay[r.date]) byDay[r.date] = v; });
    return Object.keys(byDay).sort().map(d => ({ x: new Date(d + 'T00:00:00'), y: byDay[d] }));
  }
  function weeklyTrend(lift){
    const s = liftSeries(lift); if (s.length < 3) return NaN;
    const n = s.length, x0 = s[0].x.getTime();
    const xs = s.map(p => (p.x.getTime() - x0) / 6048e5), ys = s.map(p => p.y);
    const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
    let num = 0, den = 0; xs.forEach((x,i) => { num += (x-mx)*(ys[i]-my); den += (x-mx)*(x-mx); });
    if (den === 0) return NaN;
    return (num / den) / my;
  }
  function renderLog(){
    const lift = $id('lg-view').value;
    const s = liftSeries(lift);
    const pts = s.map(p => ({ x: p.x, y: fromKg(p.y) }));
    $id('lg-chart').innerHTML = (typeof Chart !== 'undefined' && Chart.line) ? Chart.line(pts, { label: 'Estimated 1RM (' + U() + ')' }) : '';
    const rows = log.filter(r => r.lift === lift);
    const best = rows.reduce((m, r) => Math.max(m, e1rm(r.kg, r.reps, r.rpe)), 0);
    const vol = rows.filter(r => (Date.now() - new Date(r.date).getTime()) < 7 * 864e5).reduce((a, r) => a + r.kg * r.reps * r.sets, 0);
    const tr = weeklyTrend(lift);
    $id('lg-stats').innerHTML = rows.length
      ? '<b>Best estimated 1RM:</b> ' + fmt(fromKg(best)) + ' ' + U() + '<br><b>Volume last 7 days:</b> ' + fmt(fromKg(vol), 0) + ' ' + U() +
        '<br><b>Trend:</b> ' + (isFinite(tr) ? (tr >= 0 ? '+' : '') + fmt(tr * 100, 2) + '% per week' : 'log 3+ days to see a trend')
      : 'No sets logged for ' + e(lift) + ' yet.';
    const sorted = log.slice().sort((a, b) => b.date.localeCompare(a.date));
    $id('lg-table').innerHTML = sorted.length ? table(['Date','Lift','Weight','Reps × Sets','RPE','Est. 1RM','PR',''],
      sorted.slice(0, 200).map(r => {
        const v = e1rm(r.kg, r.reps, r.rpe);
        const prior = log.filter(x => x.lift === r.lift && x.date < r.date).reduce((m, x) => Math.max(m, e1rm(x.kg, x.reps, x.rpe)), 0);
        return [e(r.date), e(r.lift), fmt(fromKg(r.kg)) + ' ' + U(), r.reps + ' × ' + r.sets, (r.rpe != null && isFinite(r.rpe)) ? r.rpe : '—', fmt(fromKg(v)),
          v > prior && prior > 0 ? '<span class="status-pill ok">PR</span>' : '', '<button class="lg-del" data-id="' + e(r.id) + '" aria-label="Delete">Delete</button>'];
      })) : '<p class="muted">Your logged sets will appear here.</p>';
  }
  $id('lg-add').addEventListener('click', () => {
    if (!okAll(['lg-weight','lg-reps','lg-sets','lg-rpe']) || !$id('lg-date').value){ $id('lg-msg').textContent = 'Please fix the highlighted boxes.'; return; }
    const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: $id('lg-date').value, lift: $id('lg-lift').value,
      kg: toKg(val('lg-weight')), reps: val('lg-reps'), sets: val('lg-sets'), rpe: isFinite(val('lg-rpe')) ? val('lg-rpe') : null };
    const prevBest = log.filter(r => r.lift === rec.lift).reduce((m, r) => Math.max(m, e1rm(r.kg, r.reps, r.rpe)), 0);
    log.push(rec); saveLog();
    const now = e1rm(rec.kg, rec.reps, rec.rpe);
    $id('lg-msg').textContent = prevBest > 0 && now > prevBest ? 'New personal record. Estimated 1RM ' + fmt(fromKg(now)) + ' ' + U() + '.' : 'Set added.';
    $id('lg-view').value = rec.lift; renderAll3();
  });
  $id('lg-table').addEventListener('click', ev => {
    const b = ev.target.closest('.lg-del'); if (!b) return;
    const i = log.findIndex(r => r.id === b.dataset.id); if (i < 0) return;
    const removed = log.splice(i, 1)[0]; saveLog(); renderAll3();
    if (undoBar) undoBar.remove();
    undoBar = document.createElement('div'); undoBar.className = 'undo-bar';
    undoBar.innerHTML = '<span>Set deleted.</span><button type="button">Undo</button>';
    document.body.appendChild(undoBar);
    undoBar.querySelector('button').addEventListener('click', () => { log.push(removed); saveLog(); renderAll3(); undoBar.remove(); });
    setTimeout(() => undoBar && undoBar.remove(), 7000);
  });
  $id('lg-csv').addEventListener('click', () => {
    if (!log.length){ say('Nothing to export yet'); return; }
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const csv = ['date,lift,weight_kg,reps,sets,rpe,e1rm_kg'].concat(log.map(r => [r.date, q(r.lift), r.kg.toFixed(2), r.reps, r.sets, r.rpe == null ? '' : r.rpe, e1rm(r.kg, r.reps, r.rpe).toFixed(2)].join(','))).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'training-log.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $id('lg-share').addEventListener('click', () => {
    const lift = $id('lg-view').value, s = liftSeries(lift);
    if (!s.length){ say('Log some ' + lift + ' sets first'); return; }
    const best = Math.max.apply(null, s.map(p => p.y)), tr = weeklyTrend(lift);
    ShareCard.present({ title: lift + ' progress', category: 'Training Log', hero: fmt(fromKg(best)), unit: U(), subtitle: 'Best estimated 1RM',
      rows: [['Sessions logged', String(s.length)], ['Weekly trend', isFinite(tr) ? fmt(tr * 100, 2) + '%' : '—']], filename: 'log-' + lift.toLowerCase() });
  });

  function renderBuilder(){
    const ids = ['pb-weeks','pb-squat','pb-bench','pb-dead','pb-round'];
    if (!okAll(ids)){ $id('pb-out').innerHTML = '<p class="error">Please fix the highlighted boxes.</p>'; return; }
    const weeks = val('pb-weeks'), inc = val('pb-round'), method = $id('pb-method').value;
    const lifts = [['Squat', val('pb-squat')], ['Bench', val('pb-bench')], ['Deadlift', val('pb-dead')]];
    const step = { Squat: 5, Bench: 2.5, Deadlift: 5 };
    let html = '';
    for (let w = 1; w <= weeks; w++){
      const rows = [];
      lifts.forEach(([name, max]) => {
        let sets = '';
        if (method === '531'){
          const cycle = Math.floor((w - 1) / 4), wk = (w - 1) % 4;
          const tm = max * 0.9 + fromKg(cycle * (step[name] === 5 ? 4.5 : 2.25));
          const scheme = [[[.65,5],[.75,5],[.85,'5+']],[[.70,3],[.80,3],[.90,'3+']],[[.75,5],[.85,3],[.95,'1+']],[[.40,5],[.50,5],[.60,5]]][wk];
          sets = scheme.map(s => rnd(tm * s[0], inc) + ' × ' + s[1]).join(', ') + (wk === 3 ? ' <span class="status-pill">deload</span>' : '');
        } else if (method === 'linear'){
          const t = (w - 1) / Math.max(1, weeks - 1);
          let p, reps, n;
          if (w === weeks && weeks >= 6){ p = .6; reps = 3; n = 3; sets = rnd(max * p, inc) + ' × ' + reps + ' × ' + n + ' <span class="status-pill">deload / test</span>'; }
          else {
            if (t < .4){ p = .70 + t * .2; reps = 8; n = 4; } else if (t < .75){ p = .78 + (t - .4) * .3; reps = 5; n = 5; } else { p = .87 + (t - .75) * .3; reps = 2; n = 4; }
            sets = rnd(max * p, inc) + ' × ' + reps + ' × ' + n + ' <span class="muted">(' + Math.round(p * 100) + '%)</span>';
          }
        } else {
          const t = (w - 1) / Math.max(1, weeks - 1);
          const reps = t < .4 ? 6 : t < .75 ? 4 : 2, rpe = Math.min(9.5, 7 + Math.round(t * 5) / 2);
          const est = rnd(max * pct(reps + (10 - rpe)), inc);
          sets = 'Top set ' + reps + ' @ RPE ' + rpe + ' (≈ ' + est + '), then 3 × ' + reps + ' at ' + rnd(est * 0.92, inc);
        }
        rows.push([e(name), sets]);
      });
      html += '<h3>Week ' + w + '</h3>' + table(['Lift', 'Sets (' + U() + ')'], rows);
    }
    $id('pb-out').innerHTML = html;
  }
  $id('pb-print').addEventListener('click', () => window.print());

  function renderWeak(){
    if (!okAll(['wk-squat','wk-bench','wk-dead'])){ $id('wk-out').innerHTML = '<p class="error">Please fix the highlighted boxes.</p>'; return; }
    const s = val('wk-squat'), b = val('wk-bench'), d = val('wk-dead');
    const bs = b / s, ds = d / s, out = [];
    const status = (v, lo, hi) => v < lo ? ['low','err'] : v > hi ? ['high','warn'] : ['balanced','ok'];
    const r1 = status(bs, .65, .75), r2 = status(ds, 1.10, 1.25);
    if (r1[0] === 'low') out.push('Your <b>bench</b> is behind. Add a second bench day, close-grip bench and dips. Target ≈ ' + fmt(s * .7) + ' ' + U() + '.');
    if (r1[0] === 'high') out.push('Your <b>squat</b> is behind your bench. Add squat frequency (2–3×/week), pause squats and leg press.');
    if (r2[0] === 'low') out.push('Your <b>deadlift</b> is behind. Add Romanian deadlifts, deficit pulls and back work. Target ≈ ' + fmt(s * 1.18) + ' ' + U() + '.');
    if (r2[0] === 'high') out.push('Your <b>squat</b> trails your deadlift. Front squats and tempo squats can bring it up.');
    if (!out.length) out.push('Your three lifts are well balanced. Keep training them evenly.');
    $id('wk-out').innerHTML = table(['Ratio','You','Typical','Status'], [
      ['Bench ÷ Squat', fmt(bs * 100, 0) + '%', '65–75%', '<span class="status-pill ' + r1[1] + '">' + r1[0] + '</span>'],
      ['Deadlift ÷ Squat', fmt(ds * 100, 0) + '%', '110–125%', '<span class="status-pill ' + r2[1] + '">' + r2[0] + '</span>']
    ]) + '<h3>What to focus on</h3><ul>' + out.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  }

  function renderPlanner(){
    const ids = ['ap-weight','ap-reps','ap-rpe','ap-round','ap-ahead','ap-flights'];
    if (!okAll(ids)){ $id('ap-out').innerHTML = '<p class="error">Please fix the highlighted boxes.</p>'; $id('ap-warm').innerHTML = ''; return; }
    const est = e1rm(val('ap-weight'), val('ap-reps'), val('ap-rpe')), inc = val('ap-round');
    const P = { safe: [.88, .94, .985], normal: [.91, .965, 1.01], aggressive: [.92, .98, 1.035] }[$id('ap-style').value];
    const a = P.map(p => rnd(est * p, inc));
    $id('ap-out').innerHTML = '<p class="muted">Estimated meet-day max: <b>' + fmt(est) + ' ' + U() + '</b></p>' +
      table(['Attempt','Weight (' + U() + ')','% of est. max','Purpose'], [
        ['Opener', '<b>' + a[0] + '</b>', fmt(a[0] / est * 100, 0) + '%', 'A weight you can triple on a bad day'],
        ['Second', '<b>' + a[1] + '</b>', fmt(a[1] / est * 100, 0) + '%', 'Secure a solid total'],
        ['Third', '<b>' + a[2] + '</b>', fmt(a[2] / est * 100, 0) + '%', a[2] > est ? 'PR attempt — only if the 2nd moved fast' : 'Near-max, high success']
      ]);
    const minsToYou = val('ap-flights') * 30 + val('ap-ahead') * 1;
    const warm = [[ '0.40', 5], ['0.55', 3], ['0.70', 2], ['0.80', 1], ['0.88', 1]].map((w, i, arr) => {
      const t = minsToYou + (arr.length - i) * 3 - 30;
      return [Math.round(minsToYou - (arr.length - i) * 3 - 2) + ' min', rnd(a[0] * parseFloat(w[0]), inc) + ' × ' + w[1]];
    });
    $id('ap-warm').innerHTML = '<h3>Warm-up schedule</h3><p class="muted">You lift in about <b>' + minsToYou + ' min</b> (≈ 1 min per attempt, 30 min per flight). Minutes shown are from now; negative = start immediately.</p>' +
      table(['Start at', 'Set (' + U() + ')'], warm.concat([[minsToYou + ' min', '<b>Opener ' + a[0] + '</b>']]));
  }

  function workload(){
    const now = Date.now(), day = 864e5;
    const vol = (from, to) => log.filter(r => { const t = now - new Date(r.date + 'T12:00:00').getTime(); return t >= from * day && t < to * day; })
      .reduce((a, r) => a + r.kg * r.reps * r.sets, 0);
    const acute = vol(0, 7), chronic = vol(0, 28) / 4;
    return { acute, chronic, ratio: chronic > 0 ? acute / chronic : NaN };
  }
  function renderFatigue(){
    ['ft-sore','ft-stress','ft-mot'].forEach(i => $id(i + '-o').textContent = $id(i).value);
    if (!okAll(['ft-sleep','ft-rpe'])){ $id('ft-score').textContent = '—'; return; }
    const sleep = Math.max(0, Math.min(1, (val('ft-sleep') - 4) / 4));
    const sub = (val('ft-sore') + val('ft-stress') + val('ft-mot') - 3) / 12;
    const rpe = Math.max(0, Math.min(1, (10 - val('ft-rpe')) / 3));
    const w = workload();
    let load = 0.7, loadTxt = 'Not enough logged data — assumed normal.';
    if (isFinite(w.ratio)){
      load = w.ratio < 0.8 ? 0.9 : w.ratio <= 1.3 ? 0.75 : w.ratio <= 1.5 ? 0.4 : 0.15;
      loadTxt = 'Last 7 days vs. average week: ' + fmt(w.ratio, 2) + '× ' + (w.ratio > 1.3 ? '(spike — injury risk rises)' : w.ratio < 0.8 ? '(light)' : '(steady)');
    }
    const score = Math.round((sleep * .3 + sub * .35 + rpe * .15 + load * .2) * 100);
    $id('ft-score').textContent = score + ' / 100';
    $id('ft-meter').style.width = score + '%';
    const v = score >= 70 ? ['Push today', 'ok', 'Go for planned weights or a little more.'] : score >= 45 ? ['Train as planned', 'warn', 'Stick to the plan; skip extra top sets.'] : ['Back off', 'err', 'Reduce weights 10–15% or take a recovery day.'];
    $id('ft-verdict').innerHTML = '<span class="status-pill ' + v[1] + '">' + v[0] + '</span> ' + v[2];
    $id('ft-detail').innerHTML = 'Sleep: ' + Math.round(sleep * 100) + '% · Feel: ' + Math.round(sub * 100) + '% · Last session: ' + Math.round(rpe * 100) + '%<br>' + e(loadTxt);
  }

  function ageFactor(age){
    if (age < 14) return 1;
    if (age <= 23){ const t = { 14:1.23,15:1.18,16:1.13,17:1.08,18:1.06,19:1.04,20:1.03,21:1.02,22:1.01,23:1.0 }; return t[Math.round(age)] || 1; }
    if (age <= 40) return 1;
    const pts = [[40,1],[45,1.06],[50,1.13],[55,1.21],[60,1.31],[65,1.43],[70,1.56],[75,1.73],[80,1.92],[90,2.4]];
    for (let i = 1; i < pts.length; i++) if (age <= pts[i][0]){ const [a0,f0] = pts[i-1], [a1,f1] = pts[i]; return f0 + (f1 - f0) * (age - a0) / (a1 - a0); }
    return 2.4;
  }
  function normCdf(z){ const t = 1 / (1 + .2316419 * Math.abs(z)); const d = .3989423 * Math.exp(-z * z / 2);
    const p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  let lastPc = null;
  function renderPercentile(){
    const ids = ['pc-age','pc-bw','pc-squat','pc-bench','pc-dead'];
    if (!okAll(ids)){ $id('pc-big').textContent = '—'; return; }
    const sex = $id('pc-sex').value, age = val('pc-age'), bw = toKg(val('pc-bw'));
    const total = toKg(val('pc-squat') + val('pc-bench') + val('pc-dead'));
    const d = Scoring.dots(total, bw, sex).score, af = ageFactor(age), adj = d * af;
    const mu = sex === 'female' ? 300 : 330, sd = sex === 'female' ? 70 : 75;
    const p = Math.max(0.1, Math.min(99.9, normCdf((adj - mu) / sd) * 100));
    lastPc = { p, adj, d, total };
    $id('pc-big').textContent = 'Top ' + fmt(100 - p, 1) + '%';
    $id('pc-meter').style.width = p + '%';
    $id('pctl-summary').textContent = 'Stronger than about ' + fmt(p, 0) + '% of raw competitive ' + (sex === 'female' ? 'women' : 'men') + ' lifters (age-adjusted).';
    const level = adj < 250 ? 'Novice' : adj < 320 ? 'Intermediate' : adj < 400 ? 'Advanced' : adj < 470 ? 'Elite' : 'World class';
    $id('pc-detail').innerHTML = 'Total: ' + fmt(fromKg(total)) + ' ' + U() + '<br>DOTS: ' + fmt(d, 1) + ' · Age factor: ×' + af.toFixed(2) + ' → ' + fmt(adj, 1) + '<br>Level: <b>' + level + '</b>';
  }
  $id('pc-share').addEventListener('click', () => {
    if (!lastPc) return;
    ShareCard.present({ title: 'Strength percentile', category: 'Powerlifting', hero: 'Top ' + fmt(100 - lastPc.p, 0) + '%', unit: '', subtitle: 'Age-adjusted, vs. raw competitive lifters',
      rows: [['Total', fmt(fromKg(lastPc.total)) + ' ' + U()], ['DOTS', fmt(lastPc.d, 1)]], filename: 'percentile' });
  });

  let lastGoal = null;
  function renderGoal(){
    if (!okAll(['gl-current','gl-target'])){ $id('gl-weeks').textContent = '—'; return; }
    const cur = val('gl-current'), tgt = val('gl-target'), lift = $id('gl-lift').value;
    if (tgt <= cur){ $id('gl-weeks').textContent = 'Reached'; $id('gl-summary').textContent = 'Your target is at or below your current level — set a new goal.'; $id('gl-meter').style.width = '100%'; $id('gl-table').innerHTML = ''; return; }
    let rate = { beginner: .02, intermediate: .006, advanced: .0025 }[$id('gl-exp').value], src = 'typical for your experience level';
    if ($id('gl-uselog').checked && lift !== 'Total'){ const tr = weeklyTrend(lift); if (isFinite(tr) && tr > 0.0005){ rate = Math.min(tr, .04); src = 'from your Training Log trend'; } }
    const weeks = Math.ceil(Math.log(tgt / cur) / Math.log(1 + rate));
    const date = new Date(Date.now() + weeks * 6048e5);
    lastGoal = { lift, cur, tgt, weeks, date };
    $id('gl-weeks').textContent = weeks > 520 ? '10+ years' : weeks + ' weeks';
    $id('gl-summary').textContent = 'Expected around ' + date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + ' at ' + fmt(rate * 100, 2) + '% per week (' + src + ').';
    $id('gl-meter').style.width = Math.max(3, Math.min(100, cur / tgt * 100)) + '%';
    const rows = [];
    for (let i = 1; i <= Math.min(weeks, 520); i += Math.max(1, Math.ceil(weeks / 8))) rows.push(['Week ' + i, fmt(cur * Math.pow(1 + rate, i)) + ' ' + U()]);
    rows.push(['Week ' + weeks, '<b>' + fmt(tgt) + ' ' + U() + '</b>']);
    $id('gl-table').innerHTML = table(['Milestone', 'Expected'], rows);
  }
  $id('gl-share').addEventListener('click', () => {
    if (!lastGoal) return;
    ShareCard.present({ title: lastGoal.lift + ' goal', category: 'Goal', hero: fmt(lastGoal.tgt), unit: U(), subtitle: 'Target in about ' + lastGoal.weeks + ' weeks',
      rows: [['Current', fmt(lastGoal.cur) + ' ' + U()], ['Expected', lastGoal.date.toLocaleDateString()]], filename: 'goal' });
  });

  let total = 120, left = 120, tick = null;
  const show = () => { const m = Math.floor(left / 60), s = left % 60; $id('tm2-display').textContent = m + ':' + String(s).padStart(2, '0'); $id('tm2-display').classList.toggle('done', left === 0); };
  function beep(){
    if (!$id('tm2-sound').checked) return;
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); [0, .35, .7].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(.25, ac.currentTime + t); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + .2); }); } catch (err){}
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  }
  function stop(){ clearInterval(tick); tick = null; $id('tm2-start').textContent = 'Start'; }
  $id('tm2-presets').addEventListener('click', ev => { const b = ev.target.closest('button[data-sec]'); if (!b) return; stop(); total = left = +b.dataset.sec; show(); });
  $id('tm2-start').addEventListener('click', () => {
    if (left === 0) left = total;
    stop(); $id('tm2-start').textContent = 'Restart';
    const end = Date.now() + left * 1000;
    tick = setInterval(() => { left = Math.max(0, Math.round((end - Date.now()) / 1000)); show(); if (left === 0){ stop(); beep(); } }, 250);
  });
  $id('tm2-pause').addEventListener('click', stop);
  $id('tm2-add').addEventListener('click', () => { left += 15; if (tick){ stop(); $id('tm2-start').click(); } else show(); });
  show();

  function renderWarm(){
    if (!okAll(['wu2-target','wu2-bar','wu2-round'])){ $id('wu2-out').innerHTML = ''; return; }
    const t = val('wu2-target'), bar = val('wu2-bar'), inc = val('wu2-round');
    const steps = [[0, 10, 'Empty bar'], [.4, 5], [.6, 3], [.75, 2], [.85, 1], [.92, 1]];
    const seen = new Set(), rows = [];
    steps.forEach(s => { const w = s[0] === 0 ? bar : Math.max(bar, rnd(t * s[0], inc)); if (w >= t || seen.has(w)) return; seen.add(w); rows.push([fmt(w) + ' ' + U(), s[1], s[2] || Math.round(s[0] * 100) + '%', s[0] >= .85 ? '2–3 min' : '1 min']); });
    rows.push(['<b>' + fmt(t) + ' ' + U() + '</b>', 'Work', '100%', '—']);
    $id('wu2-out').innerHTML = table(['Weight', 'Reps', '%', 'Rest after'], rows);
  }

  function runTests(){
    const T = [
      ['Wilks 2020 · male 100 kg, 700 kg', () => Scoring.wilks(700, 100, 'male').score, 510.553],
      ['Wilks 2020 · female 60 kg, 400 kg', () => Scoring.wilks(400, 60, 'female').score, 527.613],
      ['DOTS · male 100 kg, 700 kg', () => Scoring.dots(700, 100, 'male').score, 430.861],
      ['DOTS · female 60 kg, 400 kg', () => Scoring.dots(400, 60, 'female').score, 443.418],
      ['IPF GL classic · male 100 kg, 700 kg', () => { const el = $id('sc-event'), old = el && el.value; if (el) el.value = 'classic_pl'; const r = Scoring.ipfgl(700, 100, 'male').score; if (el) el.value = old; return r; }, 88.430],
      ['IPF GL classic · female 60 kg, 400 kg', () => { const el = $id('sc-event'), old = el && el.value; if (el) el.value = 'classic_pl'; const r = Scoring.ipfgl(400, 60, 'female').score; if (el) el.value = old; return r; }, 90.416],
      ['Epley · 100 × 5', () => Formulas.calc('epley', 100, 5), 116.667],
      ['Brzycki · 100 × 5', () => Formulas.calc('brzycki', 100, 5), 112.5],
      ['1 rep returns the weight (Epley)', () => Formulas.calc('epley', 140, 1), 140],
      ['kg → lb · 100 kg', () => 100 / LB, 220.462],
      ['Readiness e1RM · 100 × 3 @ RPE 8', () => e1rm(100, 3, 8), 116.667]
    ];
    let pass = 0;
    const rows = T.map(([name, fn, exp]) => {
      let got; try { got = fn(); if (got && typeof got === 'object') got = got.value != null ? got.value : got.estimate; } catch (err){ got = NaN; }
      const ok = isFinite(got) && Math.abs(got - exp) <= Math.max(0.05, Math.abs(exp) * 0.0005);
      if (ok) pass++;
      return [e(name), fmt(exp, 3), isFinite(got) ? Number(got).toFixed(3) : 'error', ok ? '<span class="status-pill ok">Pass</span>' : '<span class="status-pill err">Fail</span>'];
    });
    $id('st-big').textContent = pass + ' / ' + T.length + ' passed';
    $id('st-out').innerHTML = table(['Check', 'Expected', 'Got', 'Result'], rows);
  }
  $id('st-run').addEventListener('click', runTests);

  function renderAll3(){
    [renderLog, renderBuilder, renderWeak, renderPlanner, renderFatigue, renderPercentile, renderGoal, renderWarm].forEach(f => { try { f(); } catch (err){ console.error(err); } });
  }
  const panels3 = ['panel-log','panel-builder','panel-weak','panel-planner','panel-fatigue','panel-percentile','panel-goal','panel-timer'];
  panels3.forEach(p => { const el = $id(p); ['input','change'].forEach(t => el.addEventListener(t, () => setTimeout(renderAll3, 0))); });
  document.addEventListener('tab:change', ev => {
    renderAll3();
    // v3.1 fix: also re-run the block-1 renderer pipeline on every tab change.
    // Previously PanelBadges (and other block-1 panels) rendered only at boot,
    // so the badges grid showed stale counts until a settings/unit change
    // happened to trigger renderAll(). All renderers are idempotent and
    // individually try/catch-guarded, so this is safe to run per navigation.
    if (typeof renderAll === 'function') { try { renderAll(); } catch (err){} }
    if (ev.detail && ev.detail.id === 'selftest') runTests();
  });

  loadProfileForm();
  restore(store(AUTO), false);
  const p = profile(); if (p && !store(AUTO)) applyProfile(p);
  if (typeof renderAll === 'function') try { renderAll(); } catch (err){}
  renderAll3();
})();
