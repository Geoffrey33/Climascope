/*
 * Climascope Card
 * Home Assistant Lovelace card: home average, outdoor temperature and one tile per room
 * (temperature / humidity / heating) with colour thresholds, trends, sensor health,
 * long-press history graph and a full visual editor.
 *
 * https://github.com/Geoffrey33/Climascope — MIT License
 * Resource: /local/climascope-card.js (JavaScript module) — type: custom:climascope-card
 */

const VERSION = "1.0.0";
const CARD_TAG = "climascope-card";
const EDITOR_TAG = "climascope-card-editor";
const LEGACY_TAG = "climat-maison-card"; // ancien nom, gardé pour ne pas casser les tableaux de bord existants

/* ------------------------------------------------------------------ */
/* Valeurs par défaut (reprennent tes seuils actuels)                  */
/* ------------------------------------------------------------------ */

const DEFAULT_TEMP_THRESHOLDS = [
  { below: 18, color: "blue" },
  { below: 20, color: "light-blue" },
  { below: 22, color: "cyan" },
  { below: 24, color: "green" },
  { below: 26, color: "amber" },
  { below: 28, color: "orange" },
];

const DEFAULTS = {
  title: "Moyenne maison",
  icon: "mdi:home-thermometer",
  show_average_humidity: true,
  show_min_max: true,
  show_outdoor: true,
  show_outdoor_humidity: true,
  icon_circle: true,
  short_names: "none",
  short_name_length: 8,
  hold_graph: true,
  graph_duration: "24h",
  graph_metrics: "both",
  graph_scope: "all",
  graph_chart_type: "line",
  columns: 3,
  columns_mobile: 2,
  layout: "tiles",
  compact_columns: 1,
  show_setpoint: true,
  show_hvac_badge: true,
  show_preset: false,
  show_trend: true,
  trend_threshold: 0.3,
  stale_after: 120,
  battery_low: 20,
  show_sensor_alerts: true,
  temperature_default_color: "red",
  humidity_low: 30,
  humidity_high: 60,
  humidity_low_color: "orange",
  humidity_normal_color: "blue",
  humidity_high_color: "red",
  show_humidity_badge: true,
  show_humidity_emoji: true,
};

// Durées proposées pour la vue graphique (days_to_show / period du statistics-graph)
const GRAPH_DURATIONS = [
  { id: "6h", days: 0.25, period: "5minute", fr: "6 h", en: "6 h" },
  { id: "12h", days: 0.5, period: "5minute", fr: "12 h", en: "12 h" },
  { id: "24h", days: 1, period: "hour", fr: "24 h", en: "24 h" },
  { id: "3d", days: 3, period: "hour", fr: "3 j", en: "3 d" },
  { id: "7d", days: 7, period: "hour", fr: "7 j", en: "7 d" },
  { id: "30d", days: 30, period: "day", fr: "30 j", en: "30 d" },
];

const COLOR_OPTIONS = [
  "red", "pink", "purple", "deep-purple", "indigo", "blue", "light-blue",
  "cyan", "teal", "green", "light-green", "lime", "yellow", "amber",
  "orange", "deep-orange", "brown", "grey", "blue-grey", "primary", "disabled",
];

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

function cssColor(c) {
  if (!c) return "var(--primary-color)";
  if (["primary", "accent", "disabled"].includes(c)) return `var(--${c}-color)`;
  if (/^[a-z-]+$/i.test(c)) return `var(--${c}-color, ${c})`;
  return c; // #hex, rgb(), etc.
}

const toNum = (v) => {
  if (v === null || v === undefined || v === "" || v === "unknown" || v === "unavailable") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const stateNum = (st) => (st ? toNum(st.state) : null);
const numOr = (v, d) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? Number(d) : Number(v));

// Badge chauffage : hvac_action si l'entité le fournit, sinon le mode (hors "off")
const HVAC_BADGES = {
  heating: ["mdi:fire", "var(--state-climate-heat-color, #ff8100)"],
  heat: ["mdi:fire", "var(--state-climate-heat-color, #ff8100)"],
  preheating: ["mdi:fire", "var(--state-climate-heat-color, #ff8100)"],
  cooling: ["mdi:snowflake", "var(--state-climate-cool-color, #2b9af9)"],
  cool: ["mdi:snowflake", "var(--state-climate-cool-color, #2b9af9)"],
  drying: ["mdi:water-percent", "var(--state-climate-dry-color, #ff9800)"],
  dry: ["mdi:water-percent", "var(--state-climate-dry-color, #ff9800)"],
  fan: ["mdi:fan", "var(--state-climate-fan_only-color, #00bcd4)"],
  fan_only: ["mdi:fan", "var(--state-climate-fan_only-color, #00bcd4)"],
  heat_cool: ["mdi:sun-snowflake-variant", "var(--state-climate-heat_cool-color, #8a8a8a)"],
};

function tempColor(t, cfg) {
  if (t === null) return "disabled";
  const list = [...(cfg.temperature_thresholds || DEFAULT_TEMP_THRESHOLDS)]
    .filter((x) => x && Number.isFinite(Number(x.below)))
    .sort((a, b) => Number(a.below) - Number(b.below));
  for (const th of list) if (t < Number(th.below)) return th.color;
  return cfg.temperature_default_color;
}

// scope : "header" (ligne chaud/froid) ou "tile" (tuile de la pièce)
function displayName(x, cfg, scope) {
  const mode = cfg.short_names;
  const active = mode === "all" || (mode === "header" && scope === "header");
  if (!active) return x.name;
  if (x.r.short_name) return x.r.short_name;
  const max = Math.max(2, Number(cfg.short_name_length) || 8);
  return x.name.length > max ? x.name.slice(0, max - 1).trimEnd() + "…" : x.name;
}

/* ------------------------------------------------------------------ */
/* Carte                                                               */
/* ------------------------------------------------------------------ */

const CHART_COLORS = [
  "#44739e", "#e45e65", "#39c2d7", "#ff9800", "#4caf50",
  "#9c27b0", "#a1887f", "#f48fb1", "#9e9e9e", "#cddc39",
];
const PERIOD_MS = { "5minute": 300e3, hour: 3600e3, day: 864e5, week: 6048e5, month: 2592e6 };
const TIME_STEPS = [1, 2, 3, 4, 6, 12].map((h) => h * 3600e3).concat([1, 2, 3, 7, 14].map((d) => d * 864e5));

function niceStep(range, target) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

// Graphique SVG (courbes ou barres) avec légende cliquable et infobulle.
// series : [{ name, color, points: [[tMs, valeur|null], ...] }]
function createStatsChart({ lang, series, start, end, unit, type, periodMs, decimals }) {
  const wrap = document.createElement("div");
  const plot = document.createElement("div");
  plot.className = "plot";
  const box = document.createElement("div");
  const tip = document.createElement("div");
  tip.className = "tip";
  plot.append(box, tip);
  const legend = document.createElement("div");
  legend.className = "legend";
  wrap.append(plot, legend);

  const H = 220;
  const M = { l: 46, r: 10, t: 8, b: 24 };
  const DAY = 864e5;
  const range = end - start;
  const hidden = new Set();
  const nfTip = new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const tickOpts = (step) =>
    step >= DAY
      ? { day: "numeric", month: "short" }
      : range > DAY * 1.01
        ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" };
  const tipFmt = new Intl.DateTimeFormat(lang, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  let width = 0;
  let geo = null;

  const draw = () => {
    if (!width) return;
    const iw = Math.max(50, width - M.l - M.r);
    const ih = H - M.t - M.b;
    const vis = series.filter((_, i) => !hidden.has(i));
    let min = Infinity;
    let max = -Infinity;
    vis.forEach((sr) =>
      sr.points.forEach(([, v]) => {
        if (v !== null && Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      })
    );
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
    const step = niceStep(max - min, 5);
    const y0 = Math.floor(min / step) * step;
    const y1 = Math.ceil(max / step) * step;
    const yd = Math.max(0, Math.min(3, Math.ceil(-Math.log10(step))));
    const nfY = new Intl.NumberFormat(lang, { minimumFractionDigits: yd, maximumFractionDigits: yd });
    const X = (t) => Math.min(M.l + iw, Math.max(M.l, M.l + ((t - start) / range) * iw));
    const Y = (v) => M.t + (1 - (v - y0) / (y1 - y0)) * ih;

    let g = "";
    const n = Math.round((y1 - y0) / step);
    for (let k = 0; k <= n; k++) {
      const v = y0 + k * step;
      const y = Y(v);
      g += `<line x1="${M.l}" x2="${M.l + iw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--divider-color)" stroke-opacity=".7"/>`;
      g += `<text x="${M.l - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--secondary-text-color)">${nfY.format(v)}</text>`;
    }
    const tstep = TIME_STEPS.find((st) => range / st <= 7) || TIME_STEPS[TIME_STEPS.length - 1];
    const off = -new Date(start).getTimezoneOffset() * 60000;
    const tf = new Intl.DateTimeFormat(lang, tickOpts(tstep));
    for (let t = Math.ceil((start + off) / tstep) * tstep - off; t <= end; t += tstep) {
      const x = X(t);
      g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${M.t}" y2="${M.t + ih}" stroke="var(--divider-color)" stroke-opacity=".35"/>`;
      g += `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--secondary-text-color)">${esc(tf.format(t))}</text>`;
    }

    const bucketPx = Math.max(1, (periodMs / range) * iw);
    const bw = Math.max(1, (bucketPx * 0.8) / Math.max(1, vis.length));
    series.forEach((sr, i) => {
      if (hidden.has(i)) return;
      if (type === "bar") {
        const k = vis.indexOf(sr);
        sr.points.forEach(([t, v]) => {
          if (v === null || !Number.isFinite(v) || t < start - periodMs || t > end) return;
          const x = X(t) + bucketPx * 0.1 + k * bw;
          const yv = Y(v);
          const base = Y(y0);
          g += `<rect x="${x.toFixed(1)}" y="${yv.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, base - yv).toFixed(1)}" fill="${sr.color}" opacity=".9"/>`;
        });
        return;
      }
      let d = "";
      let pen = false;
      sr.points.forEach(([t, v]) => {
        if (v === null || !Number.isFinite(v) || t < start - periodMs || t > end) { pen = false; return; }
        d += `${pen ? "L" : "M"}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`;
        pen = true;
      });
      if (d) g += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    g += `<line class="cursor" y1="${M.t}" y2="${M.t + ih}" stroke="var(--secondary-text-color)" stroke-dasharray="3 3" visibility="hidden"/>`;

    box.innerHTML = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" style="display:block">${g}</svg>`;
    geo = { iw };
  };

  const hideTip = () => {
    tip.style.display = "none";
    const c = box.querySelector(".cursor");
    if (c) c.setAttribute("visibility", "hidden");
  };

  plot.addEventListener("pointermove", (e) => {
    if (!geo) return;
    const px = e.clientX - box.getBoundingClientRect().left;
    if (px < M.l || px > M.l + geo.iw) return hideTip();
    const t = start + ((px - M.l) / geo.iw) * range;
    let tShown = null;
    let rows = "";
    series.forEach((sr, i) => {
      if (hidden.has(i)) return;
      let best = null;
      let bd = Infinity;
      sr.points.forEach((pt) => {
        if (pt[1] === null) return;
        const dd = Math.abs(pt[0] - t);
        if (dd < bd) { bd = dd; best = pt; }
      });
      if (!best) return;
      if (tShown === null) tShown = best[0];
      rows += `<div><span class="dot" style="background:${sr.color}"></span>${esc(sr.name)} : <b>${nfTip.format(best[1])} ${esc(unit)}</b></div>`;
    });
    if (tShown === null) return hideTip();
    tip.innerHTML = `<div class="tipt">${esc(tipFmt.format(tShown))}</div>${rows}`;
    tip.style.display = "block";
    if (px > width / 2) { tip.style.left = "auto"; tip.style.right = `${Math.round(width - px + 12)}px`; }
    else { tip.style.right = "auto"; tip.style.left = `${Math.round(px + 12)}px`; }
    const c = box.querySelector(".cursor");
    if (c) {
      c.setAttribute("x1", px);
      c.setAttribute("x2", px);
      c.setAttribute("visibility", "visible");
    }
  });
  plot.addEventListener("pointerleave", hideTip);

  series.forEach((sr, i) => {
    const el = document.createElement("div");
    el.className = "lg";
    el.innerHTML = `<span class="dot" style="background:${sr.color}"></span>${esc(sr.name)}`;
    el.addEventListener("click", () => {
      if (hidden.has(i)) hidden.delete(i);
      else hidden.add(i);
      el.classList.toggle("off", hidden.has(i));
      draw();
    });
    legend.appendChild(el);
  });

  new ResizeObserver(() => {
    const w = Math.floor(plot.clientWidth);
    if (w && w !== width) {
      width = w;
      draw();
    }
  }).observe(plot);

  return wrap;
}

const POPUP_STYLE = `
  :host { display: block; }
  .backdrop {
    position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.5);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
  }
  .dialog {
    display: flex; flex-direction: column; overflow: hidden;
    width: min(760px, 94vw); max-height: 90vh;
    background-color: var(--primary-background-color, #1c1c1c);
    background-image: linear-gradient(var(--card-background-color), var(--card-background-color));
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    color: var(--primary-text-color);
    border-radius: var(--ha-card-border-radius, 16px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  .head { display: flex; align-items: center; gap: 8px; padding: 12px 8px 4px 20px; }
  .title { flex: 1; font-size: 18px; font-weight: 500; }
  .close {
    background: none; border: none; cursor: pointer; font-size: 20px; line-height: 1;
    padding: 8px 12px; border-radius: 50%; color: var(--secondary-text-color);
  }
  .close:hover { background: var(--divider-color); }
  .controls { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 8px 20px; }
  .group { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font: inherit; font-size: 13px; cursor: pointer; padding: 6px 12px; border-radius: 16px;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color);
  }
  .chip.on {
    background: var(--primary-color); border-color: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  .content { overflow: auto; padding: 4px 12px 16px; display: flex; flex-direction: column; gap: 12px; }
  .empty { padding: 16px; color: var(--secondary-text-color); font-size: 13px; }
  .graph {
    padding: 12px 12px 8px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
  }
  .gtitle { font-size: 16px; font-weight: 500; margin: 0 4px 8px; }
  .plot { position: relative; touch-action: pan-y; }
  .tip {
    display: none; position: absolute; top: 4px; pointer-events: none; z-index: 2;
    padding: 6px 8px; border-radius: 8px; font-size: 12px; line-height: 1.5; white-space: nowrap;
    background: var(--primary-background-color, #222); color: var(--primary-text-color);
    border: 1px solid var(--divider-color); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  .tipt { color: var(--secondary-text-color); margin-bottom: 2px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 6px 4px 0; font-size: 12px; }
  .lg { cursor: pointer; display: flex; align-items: center; }
  .lg.off { opacity: 0.4; }
  @media (max-width: 600px) {
    .dialog { width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; }
  }
`;

const CARD_STYLE = `
  :host { display: block; container-type: inline-size; }
  ha-card {
    background: none; box-shadow: none; border: none;
    display: flex; flex-direction: column; gap: 8px;
  }
  .grid {
    display: grid; gap: 8px;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  }
  @container (max-width: 420px) {
    .grid { grid-template-columns: repeat(var(--cols-m), minmax(0, 1fr)); }
  }
  .tile {
    display: flex; align-items: center; gap: 12px; padding: 12px;
    box-sizing: border-box; min-width: 0; outline: none; cursor: pointer;
    background: var(--ha-card-background, var(--card-background-color, #fff));
    border-radius: var(--ha-card-border-radius, 12px);
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
    box-shadow: var(--ha-card-box-shadow, none);
  }
  .tile.noaction { cursor: default; }
  .tile { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .tile:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
  .icon {
    position: relative; flex: none; width: 36px; height: 36px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent);
    --mdc-icon-size: 20px;
  }
  .badge {
    position: absolute; top: -3px; right: -3px; width: 16px; height: 16px;
    border-radius: 50%; background: var(--b); color: #fff;
    display: flex; align-items: center; justify-content: center; --mdc-icon-size: 12px;
  }
  .icon.plain { background: none; --mdc-icon-size: 26px; }
  .badge.bottom { top: auto; bottom: -3px; }
  .tile.dim { opacity: 0.55; }
  .trend { color: var(--secondary-text-color); }
  .sp { color: var(--secondary-text-color); white-space: nowrap; }
  .warn { color: var(--warning-color, #ff9800); }
  .compact .tile { padding: 8px 12px; gap: 10px; }
  .compact .icon { width: 30px; height: 30px; --mdc-icon-size: 18px; }
  .compact .icon.plain { --mdc-icon-size: 22px; }
  .compact .tile:not(.header) .info { display: flex; align-items: baseline; gap: 12px; }
  .compact .tile:not(.header) .primary { flex: 1; }
  .compact .tile:not(.header) .secondary { white-space: nowrap; text-align: right; }
  .info { min-width: 0; flex: 1; }
  .primary {
    font-size: 14px; font-weight: 500; line-height: 1.4;
    color: var(--primary-text-color);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .secondary {
    font-size: 12px; font-weight: 400; line-height: 1.4;
    color: var(--secondary-text-color);
  }
  .empty { padding: 16px; color: var(--secondary-text-color); font-size: 13px; }
`;

class ClimascopeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = null;
    this.shadowRoot.addEventListener("click", (e) => this._onActivate(e));
    this.shadowRoot.addEventListener("pointerdown", (e) => this._onDown(e));
    this.shadowRoot.addEventListener("pointermove", (e) => this._onMove(e));
    this.shadowRoot.addEventListener("pointerup", () => this._clearHold());
    this.shadowRoot.addEventListener("pointercancel", () => this._clearHold());
    this.shadowRoot.addEventListener("contextmenu", (e) => {
      const tile = this._tileOf(e);
      if (tile && this._resolve(tile.dataset.idx).hold.a.action !== "none") e.preventDefault();
    });
    this.shadowRoot.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._onActivate(e);
      }
    });
  }

  static getConfigElement() {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig(hass) {
    const states = hass?.states || {};
    const temps = Object.keys(states)
      .filter((id) => id.startsWith("sensor.") && states[id].attributes?.device_class === "temperature")
      .slice(0, 3);
    const weather = Object.keys(states).find((id) => id.startsWith("weather."));
    const cfg = {
      rooms: temps.map((id) => ({
        name: states[id].attributes?.friendly_name || id,
        temperature_entity: id,
        icon: "mdi:thermometer",
      })),
    };
    if (weather) cfg.outdoor_entity = weather;
    return cfg;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Configuration invalide");
    this._config = { ...DEFAULTS, ...config };
    this._config.temperature_thresholds = config.temperature_thresholds || DEFAULT_TEMP_THRESHOLDS;
    this._config.rooms = Array.isArray(config.rooms) ? config.rooms : [];
    this._sig = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._maybeFetchTrends();
    this._render();
  }

  connectedCallback() {
    // Re-rendu chaque minute pour détecter les capteurs devenus muets
    if (!this._tick) {
      this._tick = setInterval(() => {
        this._sig = null;
        this._maybeFetchTrends();
        this._render();
      }, 60000);
    }
  }

  _trendIds() {
    return [...new Set(this._config.rooms.map((r) => r.temperature_entity).filter(Boolean))];
  }

  // Valeur de chaque capteur de température il y a 1 h (API historique, sans state_class requise)
  async _maybeFetchTrends() {
    if (!this._hass || !this._config || this._config.show_trend === false || this._trendBusy) return;
    const ids = this._trendIds();
    const key = ids.join(",");
    if (!ids.length || (this._trendKey === key && Date.now() - (this._trendAt || 0) < 600000)) return;
    this._trendBusy = true;
    try {
      const t0 = Date.now() - 3600e3;
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(t0).toISOString(),
        end_time: new Date(t0 + 60e3).toISOString(),
        entity_ids: ids,
        include_start_time_state: true,
        significant_changes_only: false,
        minimal_response: true,
        no_attributes: true,
      });
      const past = {};
      ids.forEach((id) => {
        const row = (res?.[id] || []).find((x) => toNum(x.s ?? x.state) !== null);
        if (row) past[id] = toNum(row.s ?? row.state);
      });
      this._trends = past;
      this._trendKey = key;
      this._trendAt = Date.now();
      this._sig = null;
      this._render();
    } catch (err) {
      this._trendAt = Date.now(); // pas de nouvel essai avant 10 min
      this._trendKey = key;
    } finally {
      this._trendBusy = false;
    }
  }

  getCardSize() {
    const cols = Math.max(1, Number(this._config?.columns) || 3);
    return Math.ceil(1 + Math.ceil((this._config?.rooms?.length || 0) / cols) * 1.5);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  _signature() {
    const cfg = this._config;
    const ids = [cfg.outdoor_entity, cfg.outdoor_humidity_entity];
    cfg.rooms.forEach((r) => ids.push(r.temperature_entity, r.humidity_entity, r.climate_entity, r.battery_entity));
    return JSON.stringify([
      this._trendAt || 0,
      ids.filter(Boolean).map((id) => {
        const s = this._hass.states[id];
        const a = s?.attributes || {};
        return s
          ? [id, s.state, a.temperature, a.humidity, a.hvac_action, a.preset_mode, a.target_temp_low, a.target_temp_high, a.friendly_name]
          : [id];
      }),
    ]);
  }

  _render() {
    if (!this._config || !this._hass) return;
    const sig = this._signature();
    if (sig === this._sig) return;
    this._sig = sig;

    const cfg = this._config;
    const hass = this._hass;
    const lang = hass.locale?.language || hass.language || "fr";
    const nf1 = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const nf0 = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });

    const now = Date.now();
    const staleMs = numOr(cfg.stale_after, 0) * 60000;
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
    const ago = (ms) => {
      const m = Math.round(ms / 60000);
      if (m < 60) return rtf.format(-m, "minute");
      if (m < 2880) return rtf.format(-Math.round(m / 60), "hour");
      return rtf.format(-Math.round(m / 1440), "day");
    };
    // État d'un capteur : ok / unavailable (hors ligne) / stale (pas de mesure récente)
    const health = (id) => {
      if (!id) return { status: "none" };
      const st = hass.states[id];
      if (!st || st.state === "unavailable" || st.state === "unknown") return { status: "unavailable" };
      const last = Date.parse(st.last_reported || st.last_updated || "");
      if (staleMs > 0 && Number.isFinite(last) && now - last > staleMs) return { status: "stale", age: now - last };
      return { status: "ok" };
    };

    /* ---- données par pièce ---- */
    const rooms = cfg.rooms.map((r) => {
      const ts = r.temperature_entity ? hass.states[r.temperature_entity] : null;
      const hs = r.humidity_entity ? hass.states[r.humidity_entity] : null;
      const cs = r.climate_entity ? hass.states[r.climate_entity] : null;
      const th = health(r.temperature_entity);
      const hh = health(r.humidity_entity);
      const t = stateNum(ts);
      let trend = null;
      const past = this._trends?.[r.temperature_entity];
      if (cfg.show_trend !== false && th.status === "ok" && t !== null && past !== undefined && past !== null) {
        trend = t - past;
      }
      let setpoint = null;
      let setpointHigh = null;
      if (cs && cs.state !== "off" && cs.state !== "unavailable") {
        setpoint = toNum(cs.attributes?.temperature);
        if (setpoint === null) {
          setpoint = toNum(cs.attributes?.target_temp_low);
          setpointHigh = toNum(cs.attributes?.target_temp_high);
        }
      }
      return {
        r,
        t,
        h: stateNum(hs),
        th,
        hh,
        tOk: th.status === "ok" && t !== null,
        hOk: hh.status === "ok" && stateNum(hs) !== null,
        cs,
        setpoint,
        setpointHigh,
        trend,
        battery: r.battery_entity ? stateNum(hass.states[r.battery_entity]) : null,
        unit: ts?.attributes?.unit_of_measurement || "°C",
        name: this._roomName(r),
      };
    });

    /* ---- moyennes / extrêmes (pièces incluses et capteurs à jour) ---- */
    const included = rooms.filter((x) => !x.r.exclude_average);
    const withT = included.filter((x) => x.tOk);
    const withH = included.filter((x) => x.hOk);
    const problems = rooms.filter(
      (x) => ["unavailable", "stale"].includes(x.th.status) || ["unavailable", "stale"].includes(x.hh.status)
    ).length;
    const avgT = withT.length ? withT.reduce((a, x) => a + x.t, 0) / withT.length : null;
    const avgH = withH.length ? withH.reduce((a, x) => a + x.h, 0) / withH.length : null;
    const unit = withT[0]?.unit || "°C";
    let hot = null, cold = null;
    withT.forEach((x) => {
      if (!hot || x.t > hot.t) hot = x;
      if (!cold || x.t < cold.t) cold = x;
    });

    /* ---- extérieur ---- */
    const o = cfg.outdoor_entity ? hass.states[cfg.outdoor_entity] : null;
    let oT = null, oH = null, oUnit = "°C";
    if (o) {
      if (cfg.outdoor_entity.startsWith("weather.")) {
        oT = toNum(o.attributes?.temperature);
        oH = toNum(o.attributes?.humidity);
        oUnit = o.attributes?.temperature_unit || "°C";
      } else {
        oT = toNum(o.state);
        oUnit = o.attributes?.unit_of_measurement || "°C";
      }
    }
    if (cfg.outdoor_humidity_entity) oH = stateNum(hass.states[cfg.outdoor_humidity_entity]);

    /* ---- en-tête ---- */
    const parts = [];
    if (cfg.show_min_max && withT.length > 1) {
      parts.push(`🔥 ${esc(displayName(hot, cfg, "header"))} ${nf1.format(hot.t)}${esc(hot.unit)}`);
      parts.push(`❄️ ${esc(displayName(cold, cfg, "header"))} ${nf1.format(cold.t)}${esc(cold.unit)}`);
    }
    if (cfg.show_outdoor && o) {
      let ext = `🌳 Ext. ${oT === null ? "—" : nf1.format(oT) + esc(oUnit)}`;
      if (cfg.show_outdoor_humidity && oH !== null) ext += ` · ${nf0.format(oH)}%`;
      parts.push(ext);
    }
    if (cfg.show_sensor_alerts !== false && problems) {
      parts.push(`<span class="warn">⚠️ ${problems} ${esc(this._lbl(problems > 1 ? "sensors_down" : "sensor_down"))}</span>`);
    }
    const top = [`🌡️ ${avgT === null ? "—" : nf1.format(avgT) + esc(unit)}`];
    if (cfg.show_average_humidity && avgH !== null) top.push(`💧 ${nf0.format(avgH)}%`);
    const headerPrimary = `${top.join("  ·  ")}${cfg.title ? " — " + esc(cfg.title) : ""}`;
    const iconCls = cfg.icon_circle === false ? "icon plain" : "icon";
    const clickable = (idx) => {
      const x = this._resolve(idx);
      return x.tap.a.action !== "none" || x.hold.a.action !== "none";
    };
    const headerAction = clickable("h");

    const header = `
      <div class="tile header ${headerAction ? "" : "noaction"}" data-idx="h" ${headerAction ? 'tabindex="0" role="button"' : ""}
           style="--c:${cssColor(tempColor(avgT, cfg))}">
        <div class="${iconCls}"><ha-icon icon="${esc(cfg.icon)}"></ha-icon></div>
        <div class="info">
          <div class="primary">${headerPrimary}</div>
          ${parts.length ? `<div class="secondary">${parts.join("  ·  ")}</div>` : ""}
        </div>
      </div>`;

    /* ---- tuiles pièces ---- */
    const compact = cfg.layout === "compact";
    const thr = Math.abs(numOr(cfg.trend_threshold, 0.3));
    const tiles = rooms.map((x, i) => {
      const { r } = x;
      const lines = [];
      const off = x.th.status === "unavailable" || (!r.temperature_entity && x.hh.status === "unavailable");
      const stale = x.th.status === "stale" || (!r.temperature_entity && x.hh.status === "stale");

      if (r.temperature_entity) {
        let l = `🌡️ ${x.t === null || off ? "—" : nf1.format(x.t) + esc(x.unit)}`;
        if (x.trend !== null) {
          const sign = x.trend > 0 ? "+" : "";
          const title = `${sign}${nf1.format(x.trend)} ${x.unit} / 1 h`;
          const arrow = x.trend >= thr ? "↑" : x.trend <= -thr ? "↓" : "→";
          l += ` <span class="trend" title="${esc(title)}">${arrow}</span>`;
        }
        if (cfg.show_setpoint !== false && x.setpoint !== null) {
          const sp = x.setpointHigh !== null
            ? `${nf1.format(x.setpoint)}–${nf1.format(x.setpointHigh)}°`
            : `${nf1.format(x.setpoint)}°`;
          l += ` <span class="sp" title="${esc(this._lbl("setpoint"))}">🎯 ${sp}</span>`;
        }
        lines.push(l);
      }

      let badge = "";
      if (r.humidity_entity) {
        const hOff = x.hh.status === "unavailable";
        let l = `💧 ${x.h === null || hOff ? "—" : nf0.format(x.h) + "%"}`;
        if (x.h !== null && !hOff) {
          const hiThr = numOr(r.humidity_high, cfg.humidity_high);
          const loThr = numOr(r.humidity_low, cfg.humidity_low);
          const tooHigh = x.h > hiThr;
          const tooLow = x.h < loThr;
          if (cfg.show_humidity_emoji) l += tooHigh ? " ⚠️" : tooLow ? " 🏜️" : "";
          if (cfg.show_humidity_badge && (tooHigh || tooLow)) {
            badge = `<span class="badge" style="--b:${cssColor(tooHigh ? cfg.humidity_high_color : cfg.humidity_low_color)}">
              <ha-icon icon="${tooHigh ? "mdi:water-alert" : "mdi:water-off"}"></ha-icon></span>`;
          }
        }
        lines.push(l);
      }

      // Chauffage : badge en bas à droite + préréglage éventuel
      if (x.cs && cfg.show_hvac_badge !== false) {
        const action = x.cs.attributes?.hvac_action;
        const key = action !== undefined ? action : x.cs.state;
        const b = HVAC_BADGES[key];
        if (b) badge += `<span class="badge bottom" style="--b:${b[1]}" title="${esc(key)}"><ha-icon icon="${b[0]}"></ha-icon></span>`;
      }
      if (x.cs && cfg.show_preset && x.cs.attributes?.preset_mode) {
        const pm = x.cs.attributes.preset_mode;
        const pmLabel = hass.formatEntityAttributeValue ? hass.formatEntityAttributeValue(x.cs, "preset_mode") : pm;
        lines.push(`🏷️ ${esc(pmLabel)}`);
      }

      if (x.battery !== null && x.battery <= numOr(cfg.battery_low, 20)) {
        lines.push(`<span class="warn">🪫 ${nf0.format(x.battery)}%</span>`);
      }
      if (off) lines.push(`<span class="warn">${esc(this._lbl("unavailable"))}</span>`);
      else if (stale) {
        const age = x.th.status === "stale" ? x.th.age : x.hh.age;
        lines.push(`<span class="warn" title="${esc(this._lbl("stale"))}">⏱️ ${esc(ago(age))}</span>`);
      }

      const action = clickable(i);
      const color = off || stale ? "disabled" : tempColor(x.t, cfg);
      return `
        <div class="tile ${action ? "" : "noaction"} ${off || stale ? "dim" : ""}" data-idx="${i}" ${action ? 'tabindex="0" role="button"' : ""}
             style="--c:${cssColor(color)}">
          <div class="${iconCls}"><ha-icon icon="${esc(r.icon || "mdi:thermometer")}"></ha-icon>${badge}</div>
          <div class="info">
            <div class="primary">${esc(displayName(x, cfg, "tile"))}</div>
            <div class="secondary">${lines.join(compact ? "  ·  " : "<br>")}</div>
          </div>
        </div>`;
    });

    const cols = compact
      ? Math.min(6, Math.max(1, Number(cfg.compact_columns) || 1))
      : Math.min(6, Math.max(1, Number(cfg.columns) || 3));
    const colsM = compact ? 1 : Math.min(cols, Math.max(1, Number(cfg.columns_mobile) || 2));

    this.shadowRoot.innerHTML = `
      <style>${CARD_STYLE}</style>
      <ha-card class="${compact ? "compact" : ""}">
        ${header}
        ${
          tiles.length
            ? `<div class="grid" style="--cols:${cols};--cols-m:${colsM}">${tiles.join("")}</div>`
            : `<div class="empty">${esc(this._lbl("no_rooms"))}</div>`
        }
      </ha-card>`;
  }

  /* ---- actions ---- */
  _tileOf(e) {
    return e.composedPath().find((n) => n.dataset && n.dataset.idx !== undefined);
  }

  // Résout les actions toucher / appui long d'une tuile ("h" = en-tête)
  _resolve(idx) {
    const cfg = this._config;
    const isHeader = idx === "h";
    const src = isHeader ? cfg : cfg.rooms[Number(idx)] || {};
    const base = isHeader ? cfg.outdoor_entity : src.temperature_entity || src.humidity_entity;
    const tapDefault = isHeader && !src.tap_entity ? "none" : "more-info";
    // Appui long : action explicite > entité explicite (plus d'infos) > graphique > défaut
    let holdA;
    if (src.hold_action) holdA = src.hold_action;
    else if (src.hold_entity) holdA = { action: "more-info" };
    else if (cfg.hold_graph !== false) holdA = { action: "graph" };
    else holdA = { action: src.tap_entity || src.climate_entity ? "more-info" : "none" };
    return {
      tap: { a: src.tap_action || { action: tapDefault }, entity: src.tap_entity || src.climate_entity || base },
      hold: { a: holdA, entity: src.hold_entity || base },
    };
  }

  _onActivate(e) {
    if (this._held) {
      this._held = false;
      return;
    }
    const tile = this._tileOf(e);
    if (!tile) return;
    const { tap } = this._resolve(tile.dataset.idx);
    this._runAction(tap.a, tap.entity, tile.dataset.idx);
  }

  _onDown(e) {
    this._held = false;
    this._clearHold();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const tile = this._tileOf(e);
    if (!tile) return;
    const { hold } = this._resolve(tile.dataset.idx);
    if (hold.a.action === "none") return;
    this._x = e.clientX;
    this._y = e.clientY;
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      this._held = true;
      if (navigator.vibrate) navigator.vibrate(30);
      this._runAction(hold.a, hold.entity, tile.dataset.idx);
    }, 500);
  }

  _onMove(e) {
    if (this._holdTimer && Math.hypot(e.clientX - this._x, e.clientY - this._y) > 10) this._clearHold();
  }

  _clearHold() {
    if (this._holdTimer) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
  }

  /* ---- vue graphique (appui long) ---- */
  disconnectedCallback() {
    this._closeGraph();
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  _lbl(key) {
    const l = (this._hass?.language || "fr").startsWith("fr") ? "fr" : "en";
    return LABELS[l][key] ?? key;
  }

  _openGraph(idx) {
    this._closeGraph();
    const cfg = this._config;
    const roomIdx = idx === "h" || idx === undefined ? null : Number(idx);
    const validDur = GRAPH_DURATIONS.some((d) => d.id === cfg.graph_duration);
    this._gs = {
      roomIdx,
      duration: validDur ? cfg.graph_duration : "24h",
      temp: cfg.graph_metrics !== "humidity",
      hum: cfg.graph_metrics !== "temperature",
      scope: roomIdx !== null && cfg.graph_scope === "room" ? roomIdx : "all",
    };
    // La popup vit dans <body> : le conteneur de la carte (container-type) piégerait un overlay fixed.
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" });
    document.body.appendChild(host);
    this._popup = { host, root: host.shadowRoot };
    this._onKey = (e) => {
      if (e.key === "Escape") this._closeGraph();
    };
    document.addEventListener("keydown", this._onKey);
    this._renderGraph();
  }

  _closeGraph() {
    if (this._onKey) {
      document.removeEventListener("keydown", this._onKey);
      this._onKey = null;
    }
    if (this._popup) {
      this._popup.host.remove();
      this._popup = null;
    }
  }

  _renderGraph() {
    const pop = this._popup;
    if (!pop) return;
    const cfg = this._config;
    const gs = this._gs;
    const lang = (this._hass?.language || "fr").startsWith("fr") ? "fr" : "en";
    const room = gs.roomIdx !== null ? cfg.rooms[gs.roomIdx] || {} : null;
    const roomName = room ? this._roomName(room) : "";
    const title = gs.scope === "all" ? cfg.title || this._lbl("g_title") : roomName;
    const chip = (k, v, label, on) =>
      `<button class="chip ${on ? "on" : ""}" data-k="${k}" data-v="${esc(v)}">${label}</button>`;
    const durations = GRAPH_DURATIONS.map((d) => chip("duration", d.id, d[lang], gs.duration === d.id)).join("");
    const metrics =
      chip("temp", "1", `🌡️ ${esc(this._lbl("g_temp"))}`, gs.temp) +
      chip("hum", "1", `💧 ${esc(this._lbl("g_hum"))}`, gs.hum);
    const scopes = room
      ? `<div class="group">${chip("scope", "all", esc(this._lbl("g_all")), gs.scope === "all")}${chip(
          "scope", String(gs.roomIdx), esc(roomName), gs.scope === gs.roomIdx
        )}</div>`
      : "";

    const root = pop.root;
    root.innerHTML = `
      <style>${POPUP_STYLE}</style>
      <div class="backdrop">
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="head">
            <div class="title">${esc(title)}</div>
            <button class="close" aria-label="${esc(this._lbl("g_close"))}">✕</button>
          </div>
          <div class="controls">
            <div class="group">${durations}</div>
            <div class="group">${metrics}</div>
            ${scopes}
          </div>
          <div class="content"></div>
        </div>
      </div>`;

    root.querySelector(".backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("backdrop")) this._closeGraph();
    });
    root.querySelector(".close").addEventListener("click", () => this._closeGraph());
    root.querySelector(".controls").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const { k, v } = b.dataset;
      if (k === "duration") gs.duration = v;
      else if (k === "scope") gs.scope = v === "all" ? "all" : Number(v);
      else if (k === "temp" || k === "hum") {
        const other = k === "temp" ? "hum" : "temp";
        if (gs[k] && !gs[other]) return; // au moins un des deux reste affiché
        gs[k] = !gs[k];
      }
      this._renderGraph();
    });

    this._renderBuiltin(root.querySelector(".content"));
  }

  _areaName(entityId) {
    const h = this._hass;
    if (!entityId || !h) return "";
    const ent = h.entities?.[entityId];
    let areaId = ent?.area_id;
    if (!areaId && ent?.device_id) areaId = h.devices?.[ent.device_id]?.area_id;
    return (areaId && h.areas?.[areaId]?.name) || "";
  }

  // Nom affiché d'une pièce : nom saisi > nom de la zone (area) > nom de l'entité
  _roomName(r) {
    const eid = r.temperature_entity || r.humidity_entity;
    return r.name || this._areaName(eid) || this._hass?.states?.[eid]?.attributes?.friendly_name || eid || "—";
  }

  async _fetchStats(ids, dur) {
    const key = `${dur.id}|${ids.join(",")}`;
    const hit = this._statCache && this._statCache.get(key);
    if (hit && Date.now() - hit.t < 60000) return hit.data;
    const end = new Date();
    const start = new Date(end.getTime() - dur.days * 864e5);
    const data = await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period: dur.period,
      types: ["mean"],
    });
    if (!this._statCache) this._statCache = new Map();
    this._statCache.set(key, { t: Date.now(), data });
    return data;
  }

  async _renderBuiltin(content) {
    const token = (this._rt = (this._rt || 0) + 1);
    const cfg = this._config;
    const gs = this._gs;
    const lang = (this._hass?.language || "fr").startsWith("fr") ? "fr" : "en";
    const dur = GRAPH_DURATIONS.find((d) => d.id === gs.duration) || GRAPH_DURATIONS[2];
    const rooms = cfg.rooms.map((r, i) => ({ r, i })).filter(({ i }) => gs.scope === "all" || i === gs.scope);
    const defs = [];
    if (gs.temp) defs.push({ field: "temperature_entity", label: this._lbl("g_temp"), decimals: 1, unit: "°C" });
    if (gs.hum) defs.push({ field: "humidity_entity", label: this._lbl("g_hum"), decimals: 0, unit: "%" });
    const blocks = defs
      .map((d) => ({ ...d, rooms: rooms.filter(({ r }) => r[d.field]) }))
      .filter((d) => d.rooms.length);
    if (!blocks.length) {
      content.innerHTML = `<div class="empty">${esc(this._lbl("g_none"))}</div>`;
      return;
    }
    blocks.forEach((b) => {
      b.el = document.createElement("div");
      b.el.className = "graph";
      b.el.innerHTML = `<div class="gtitle">${esc(b.label)} · ${esc(dur[lang])}</div>
        <div class="gbody"><div class="empty">${esc(this._lbl("g_loading"))}</div></div>`;
      content.appendChild(b.el);
    });

    const ids = [...new Set(blocks.flatMap((b) => b.rooms.map(({ r }) => r[b.field])))];
    let data;
    try {
      data = await this._fetchStats(ids, dur);
    } catch (err) {
      if (token !== this._rt) return;
      blocks.forEach((b) => {
        b.el.querySelector(".gbody").innerHTML =
          `<div class="empty">${esc(this._lbl("g_error"))}${esc(err?.message || JSON.stringify(err))}</div>`;
      });
      return;
    }
    if (token !== this._rt || !this._popup) return;

    const end = Date.now();
    const start = end - dur.days * 864e5;
    const toMs = (v) => (typeof v === "number" ? v : Date.parse(v));
    blocks.forEach((b) => {
      const body = b.el.querySelector(".gbody");
      const series = b.rooms.map(({ r, i }) => ({
        name: this._roomName(r),
        color: CHART_COLORS[i % CHART_COLORS.length],
        points: (data[r[b.field]] || []).map((row) => [toMs(row.start), typeof row.mean === "number" ? row.mean : null]),
      }));
      const withData = series.filter((sr) => sr.points.some(([, v]) => v !== null));
      if (!withData.length) {
        body.innerHTML = `<div class="empty">${esc(this._lbl("g_nodata"))}${esc(series.map((sr) => sr.name).join(", "))}. ${esc(this._lbl("g_nodata_hint"))}</div>`;
        return;
      }
      const unit = this._hass.states[b.rooms[0].r[b.field]]?.attributes?.unit_of_measurement || b.unit;
      body.replaceChildren(
        createStatsChart({
          lang,
          series: withData,
          start,
          end,
          unit,
          type: cfg.graph_chart_type === "bar" ? "bar" : "line",
          periodMs: PERIOD_MS[dur.period],
          decimals: b.decimals,
        })
      );
    });
  }

  _runAction(a, defaultEntity, idx) {
    const action = a?.action || "more-info";
    const entity = a?.entity || defaultEntity;
    switch (action) {
      case "graph":
        this._openGraph(idx);
        break;
      case "more-info":
        if (!entity) return;
        this.dispatchEvent(new CustomEvent("hass-more-info", {
          bubbles: true, composed: true, detail: { entityId: entity },
        }));
        break;
      case "navigate":
        if (!a.navigation_path) return;
        history.pushState(null, "", a.navigation_path);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
        break;
      case "url":
        if (a.url_path) window.open(a.url_path, "_blank");
        break;
      case "toggle":
        if (entity) this._hass.callService("homeassistant", "toggle", { entity_id: entity });
        break;
      case "perform-action":
      case "call-service": {
        const svc = a.perform_action || a.service;
        if (!svc) return;
        const [domain, service] = svc.split(".");
        this._hass.callService(domain, service, a.data || a.service_data || {}, a.target);
        break;
      }
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Éditeur visuel                                                      */
/* ------------------------------------------------------------------ */

const LABELS = {
  fr: {
    title: "Titre", icon: "Icône",
    outdoor_entity: "Entité extérieure (météo ou capteur de température)",
    outdoor_humidity_entity: "Capteur d'humidité extérieure (optionnel)",
    show_average_humidity: "Humidité moyenne", show_min_max: "Pièce la plus chaude / froide",
    show_outdoor: "Température extérieure", columns: "Colonnes", columns_mobile: "Colonnes (mobile)",
    show_outdoor_humidity: "Humidité extérieure", icon_circle: "Cercle autour de l'icône",
    short_names: "Raccourcir les noms", short_name_length: "Longueur max. des noms raccourcis",
    short_name: "Nom court (optionnel)", short_none: "Non",
    short_header: "En-tête uniquement", short_all: "En-tête et tuiles",
    tap_entity: "Entité au toucher (ex. thermostat)", hold_action: "Action à l'appui long",
    hold_entity: "Entité à l'appui long", s_header_actions: "Actions de l'en-tête",
    h_tap_entity: "Vide = capteur de température de la pièce (entité extérieure pour l'en-tête).",
    h_hold_entity: "Vide = capteur de température de la pièce (entité extérieure pour l'en-tête).",
    h_hold_action: "Si vide : graphique (voir la section Graphique), sinon aucune action.",
    h_hold_graph: "Un appui long sur une tuile ouvre un graphique des statistiques. Une action d'appui long définie sur une pièce garde la priorité.",
    s_graph: "Graphique (appui long)", hold_graph: "Afficher le graphique à l'appui long",
    graph_duration: "Durée affichée par défaut", graph_chart_type: "Type de graphique",
    graph_metrics: "Données affichées", graph_scope: "Pièces affichées à l'ouverture",
    g_line: "Courbe", g_bar: "Barres", g_temp: "Température", g_hum: "Humidité",
    g_both: "Température et humidité", g_all: "Toutes les pièces", g_room: "La pièce touchée",
    g_none: "Aucune entité à afficher.", g_close: "Fermer", g_title: "Climat",
    g_loading: "Chargement…", g_error: "Impossible de charger les statistiques : ",
    g_nodata: "Aucune statistique sur cette période pour : ",
    g_nodata_hint: "Vérifie que ces capteurs ont une state_class (measurement) et sont bien enregistrés.",
    no_rooms: "Ajoute des pièces depuis l'éditeur de la carte.",
    sensor_down: "capteur hors ligne", sensors_down: "capteurs hors ligne",
    unavailable: "Capteur injoignable", stale: "Dernière mesure", setpoint: "Consigne",
    layout: "Disposition", l_tiles: "Tuiles", l_compact: "Compacte (une ligne par pièce)",
    compact_columns: "Colonnes (mode compact)",
    s_sensors: "Chauffage, tendances et capteurs",
    show_setpoint: "Consigne du thermostat", show_hvac_badge: "Badge chauffe / refroidit",
    show_preset: "Préréglage du thermostat", show_trend: "Flèche de tendance (1 h)",
    trend_threshold: "Seuil de tendance (°C / h)", stale_after: "Capteur muet après (min)",
    battery_low: "Batterie faible sous (%)", show_sensor_alerts: "Alerte capteurs dans l'en-tête",
    h_stale_after: "0 = désactivé. La tuile se grise si le capteur n'a rien envoyé depuis ce délai.",
    h_trend_threshold: "En dessous de cet écart sur 1 h, la flèche est →.",
    climate_entity: "Thermostat (climate)", battery_entity: "Batterie du capteur (optionnel)",
    exclude_average: "Exclure des statistiques de l'en-tête",
    h_room_climate_entity: "Affiche la consigne et l'état de chauffe. Le toucher ouvre ce thermostat.",
    h_room_exclude_average: "Ni dans la moyenne, ni dans la pièce la plus chaude / froide.",
    h_room_humidity_low: "Vide = seuil global.", h_room_humidity_high: "Vide = seuil global.",
    h_room_tap_entity: "Vide = thermostat s'il est défini, sinon capteur de température.",
    tap_action: "Action au toucher", name: "Nom",
    temperature_entity: "Capteur de température", humidity_entity: "Capteur d'humidité",
    below: "En dessous de (°C)", color: "Couleur",
    temperature_default_color: "Couleur au-dessus du dernier seuil",
    humidity_low: "Humidité basse sous (%)", humidity_high: "Humidité haute au-dessus de (%)",
    humidity_low_color: "Couleur trop sec", humidity_normal_color: "Couleur normale",
    humidity_high_color: "Couleur trop humide",
    show_humidity_badge: "Badge d'alerte", show_humidity_emoji: "Emoji d'alerte",
    s_general: "Général", s_temp: "Couleurs selon la température", s_hum: "Humidité", s_rooms: "Pièces",
    add_room: "Ajouter une pièce", add_threshold: "Ajouter un seuil",
    reset: "Réinitialiser les seuils", new_room: "Nouvelle pièce",
    up: "Monter", down: "Descendre", del: "Supprimer",
  },
  en: {
    title: "Title", icon: "Icon",
    outdoor_entity: "Outdoor entity (weather or temperature sensor)",
    outdoor_humidity_entity: "Outdoor humidity sensor (optional)",
    show_average_humidity: "Average humidity", show_min_max: "Warmest / coldest room",
    show_outdoor: "Outdoor temperature", columns: "Columns", columns_mobile: "Columns (mobile)",
    show_outdoor_humidity: "Outdoor humidity", icon_circle: "Circle around the icon",
    short_names: "Shorten names", short_name_length: "Max length of shortened names",
    short_name: "Short name (optional)", short_none: "No",
    short_header: "Header only", short_all: "Header and tiles",
    tap_entity: "Tap entity (e.g. thermostat)", hold_action: "Hold action",
    hold_entity: "Hold entity", s_header_actions: "Header actions",
    h_tap_entity: "Empty = the room's temperature sensor (outdoor entity for the header).",
    h_hold_entity: "Empty = the room's temperature sensor (outdoor entity for the header).",
    h_hold_action: "If empty: graph (see the Graph section), otherwise no action.",
    h_hold_graph: "A long press on a tile opens a statistics graph. A hold action set on a room keeps priority.",
    s_graph: "Graph (long press)", hold_graph: "Show the graph on long press",
    graph_duration: "Default duration", graph_chart_type: "Chart type",
    graph_metrics: "Data shown", graph_scope: "Rooms shown on open",
    g_line: "Line", g_bar: "Bars", g_temp: "Temperature", g_hum: "Humidity",
    g_both: "Temperature and humidity", g_all: "All rooms", g_room: "The pressed room",
    g_none: "No entity to display.", g_close: "Close", g_title: "Climate",
    g_loading: "Loading…", g_error: "Could not load statistics: ",
    g_nodata: "No statistics for this period for: ",
    g_nodata_hint: "Check that these sensors have a state_class (measurement) and are recorded.",
    no_rooms: "Add rooms from the card editor.",
    sensor_down: "sensor offline", sensors_down: "sensors offline",
    unavailable: "Sensor unreachable", stale: "Last reading", setpoint: "Setpoint",
    layout: "Layout", l_tiles: "Tiles", l_compact: "Compact (one row per room)",
    compact_columns: "Columns (compact layout)",
    s_sensors: "Heating, trends and sensors",
    show_setpoint: "Thermostat setpoint", show_hvac_badge: "Heating / cooling badge",
    show_preset: "Thermostat preset", show_trend: "Trend arrow (1 h)",
    trend_threshold: "Trend threshold (°C / h)", stale_after: "Sensor silent after (min)",
    battery_low: "Low battery below (%)", show_sensor_alerts: "Sensor alert in the header",
    h_stale_after: "0 = disabled. The tile is greyed out when the sensor has not reported for this long.",
    h_trend_threshold: "Below this change over 1 h, the arrow is →.",
    climate_entity: "Thermostat (climate)", battery_entity: "Sensor battery (optional)",
    exclude_average: "Exclude from header statistics",
    h_room_climate_entity: "Shows the setpoint and heating state. Tapping opens this thermostat.",
    h_room_exclude_average: "Not in the average, nor in warmest / coldest room.",
    h_room_humidity_low: "Empty = global threshold.", h_room_humidity_high: "Empty = global threshold.",
    h_room_tap_entity: "Empty = thermostat if set, otherwise temperature sensor.",
    tap_action: "Tap action", name: "Name",
    temperature_entity: "Temperature sensor", humidity_entity: "Humidity sensor",
    below: "Below (°C)", color: "Color",
    temperature_default_color: "Color above the last threshold",
    humidity_low: "Low humidity below (%)", humidity_high: "High humidity above (%)",
    humidity_low_color: "Too dry color", humidity_normal_color: "Normal color",
    humidity_high_color: "Too humid color",
    show_humidity_badge: "Alert badge", show_humidity_emoji: "Alert emoji",
    s_general: "General", s_temp: "Colors by temperature", s_hum: "Humidity", s_rooms: "Rooms",
    add_room: "Add a room", add_threshold: "Add a threshold",
    reset: "Reset thresholds", new_room: "New room",
    up: "Move up", down: "Move down", del: "Delete",
  },
};

const EDITOR_STYLE = `
  :host { display: block; }
  details {
    border: 1px solid var(--divider-color); border-radius: 12px;
    margin: 0 0 12px; padding: 0 12px;
  }
  summary {
    cursor: pointer; padding: 12px 0; font-weight: 500; list-style: none;
    display: flex; align-items: center; gap: 4px; color: var(--primary-text-color);
  }
  summary::-webkit-details-marker { display: none; }
  .sp { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { padding-bottom: 12px; display: flex; flex-direction: column; gap: 12px; }
  .row { display: flex; align-items: center; gap: 4px; }
  .row ha-form { flex: 1; min-width: 0; }
  button.action {
    align-self: flex-start; cursor: pointer; font: inherit;
    padding: 8px 16px; border-radius: 8px; border: 1px solid var(--primary-color);
    background: none; color: var(--primary-color);
  }
  button.action.subtle { border-color: var(--divider-color); color: var(--secondary-text-color); }
  ha-icon-button { --mdc-icon-button-size: 36px; color: var(--secondary-text-color); }
`;

const colorSelect = () => ({
  select: {
    mode: "dropdown",
    custom_value: true,
    options: COLOR_OPTIONS.map((c) => ({ value: c, label: c })),
  },
});

const clean = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

class ClimascopeCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._open = new Set(["sec:general"]);
    this._syncers = [];
    this._struct = null;
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._built) this._syncers.forEach((f) => f());
  }

  setConfig(config) {
    this._config = config || {};
    const struct = JSON.stringify([
      (this._config.rooms || []).length,
      (this._config.temperature_thresholds || DEFAULT_TEMP_THRESHOLDS).length,
    ]);
    if (!this._built || struct !== this._struct) {
      this._struct = struct;
      this._build();
    } else {
      this._syncers.forEach((f) => f());
    }
  }

  /* ---- helpers ---- */
  _t(key) {
    const l = (this._hass?.language || "fr").startsWith("fr") ? "fr" : "en";
    return LABELS[l][key] ?? key;
  }

  _help(key) {
    const l = (this._hass?.language || "fr").startsWith("fr") ? "fr" : "en";
    return LABELS[l]["h_" + key] || "";
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config }, bubbles: true, composed: true,
    }));
  }

  _patch(keys, value) {
    const base = { ...this._config };
    keys.forEach((k) => delete base[k]);
    return clean({ ...base, ...value });
  }

  _form({ schema, getData, onChange, helpPrefix = "" }) {
    const f = document.createElement("ha-form");
    f.schema = schema;
    f.hass = this._hass;
    f.data = getData();
    f.computeLabel = (s) => this._t(s.name);
    f.computeHelper = (s) => this._help(helpPrefix + s.name);
    f.addEventListener("value-changed", (e) => {
      e.stopPropagation();
      onChange(e.detail.value);
    });
    this._syncers.push(() => {
      f.hass = this._hass;
      f.data = getData();
    });
    return f;
  }

  _iconButton(icon, title, onClick) {
    const b = document.createElement("ha-icon-button");
    b.title = title;
    b.setAttribute("aria-label", title);
    const i = document.createElement("ha-icon");
    i.setAttribute("icon", icon);
    b.appendChild(i);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  _button(label, onClick, subtle = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action" + (subtle ? " subtle" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  _section(id, title) {
    const d = document.createElement("details");
    d.open = this._open.has(id);
    d.addEventListener("toggle", () => {
      if (d.open) this._open.add(id);
      else this._open.delete(id);
    });
    const s = document.createElement("summary");
    const sp = document.createElement("span");
    sp.className = "sp";
    sp.textContent = title;
    s.appendChild(sp);
    d.appendChild(s);
    const body = document.createElement("div");
    body.className = "body";
    d.appendChild(body);
    return { d, s, sp, body };
  }

  /* ---- construction ---- */
  _build() {
    this._syncers = [];
    const root = this.shadowRoot;
    root.innerHTML = `<style>${EDITOR_STYLE}</style>`;
    root.appendChild(this._buildGeneral());
    root.appendChild(this._buildHeaderActions());
    root.appendChild(this._buildTemperature());
    root.appendChild(this._buildHumidity());
    root.appendChild(this._buildSensors());
    root.appendChild(this._buildGraph());
    root.appendChild(this._buildRooms());
    this._built = true;
  }

  _buildGeneral() {
    const keys = [
      "title", "icon", "outdoor_entity", "outdoor_humidity_entity",
      "show_average_humidity", "show_min_max", "show_outdoor", "show_outdoor_humidity",
      "icon_circle", "short_names", "short_name_length",
      "layout", "columns", "columns_mobile", "compact_columns",
    ];
    const schema = [
      { name: "title", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      {
        name: "outdoor_entity",
        selector: { entity: { filter: [{ domain: "weather" }, { domain: "sensor", device_class: "temperature" }] } },
      },
      { name: "outdoor_humidity_entity", selector: { entity: { domain: "sensor", device_class: "humidity" } } },
      {
        type: "grid", name: "",
        schema: [
          { name: "show_average_humidity", selector: { boolean: {} } },
          { name: "show_min_max", selector: { boolean: {} } },
          { name: "show_outdoor", selector: { boolean: {} } },
          { name: "show_outdoor_humidity", selector: { boolean: {} } },
          { name: "icon_circle", selector: { boolean: {} } },
        ],
      },
      {
        name: "layout",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "tiles", label: this._t("l_tiles") },
              { value: "compact", label: this._t("l_compact") },
            ],
          },
        },
      },
      {
        type: "grid", name: "",
        schema: [
          { name: "columns", selector: { number: { min: 1, max: 6, step: 1, mode: "box" } } },
          { name: "columns_mobile", selector: { number: { min: 1, max: 6, step: 1, mode: "box" } } },
          { name: "compact_columns", selector: { number: { min: 1, max: 6, step: 1, mode: "box" } } },
        ],
      },
      {
        type: "grid", name: "",
        schema: [
          {
            name: "short_names",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "none", label: this._t("short_none") },
                  { value: "header", label: this._t("short_header") },
                  { value: "all", label: this._t("short_all") },
                ],
              },
            },
          },
          { name: "short_name_length", selector: { number: { min: 2, max: 30, step: 1, mode: "box" } } },
        ],
      },
    ];
    const sec = this._section("sec:general", this._t("s_general"));
    sec.body.appendChild(
      this._form({
        schema,
        getData: () => {
          const merged = { ...DEFAULTS, ...this._config };
          return Object.fromEntries(keys.filter((k) => merged[k] !== undefined).map((k) => [k, merged[k]]));
        },
        onChange: (v) => this._emit(this._patch(keys, v)),
      })
    );
    return sec.d;
  }

  _buildSensors() {
    const keys = [
      "show_setpoint", "show_hvac_badge", "show_preset", "show_trend", "trend_threshold",
      "stale_after", "battery_low", "show_sensor_alerts",
    ];
    const schema = [
      {
        type: "grid", name: "",
        schema: [
          { name: "show_setpoint", selector: { boolean: {} } },
          { name: "show_hvac_badge", selector: { boolean: {} } },
          { name: "show_preset", selector: { boolean: {} } },
          { name: "show_trend", selector: { boolean: {} } },
          { name: "show_sensor_alerts", selector: { boolean: {} } },
        ],
      },
      { name: "trend_threshold", selector: { number: { min: 0, max: 5, step: 0.1, mode: "box", unit_of_measurement: "°C" } } },
      { name: "stale_after", selector: { number: { min: 0, max: 1440, step: 5, mode: "box", unit_of_measurement: "min" } } },
      { name: "battery_low", selector: { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } } },
    ];
    const sec = this._section("sec:sensors", this._t("s_sensors"));
    sec.body.appendChild(
      this._form({
        schema,
        getData: () => {
          const merged = { ...DEFAULTS, ...this._config };
          return Object.fromEntries(keys.map((k) => [k, merged[k]]));
        },
        onChange: (v) => this._emit(this._patch(keys, v)),
      })
    );
    return sec.d;
  }

  _buildGraph() {
    const keys = ["hold_graph", "graph_duration", "graph_metrics", "graph_scope", "graph_chart_type"];
    const lang = (this._hass?.language || "fr").startsWith("fr") ? "fr" : "en";
    const opt = (options) => ({ select: { mode: "dropdown", options } });
    const schema = [
      { name: "hold_graph", selector: { boolean: {} } },
      {
        type: "grid", name: "",
        schema: [
          { name: "graph_duration", selector: opt(GRAPH_DURATIONS.map((d) => ({ value: d.id, label: d[lang] }))) },
          {
            name: "graph_chart_type",
            selector: opt([
              { value: "line", label: this._t("g_line") },
              { value: "bar", label: this._t("g_bar") },
            ]),
          },
        ],
      },
      {
        name: "graph_metrics",
        selector: opt([
          { value: "both", label: this._t("g_both") },
          { value: "temperature", label: this._t("g_temp") },
          { value: "humidity", label: this._t("g_hum") },
        ]),
      },
      {
        name: "graph_scope",
        selector: opt([
          { value: "all", label: this._t("g_all") },
          { value: "room", label: this._t("g_room") },
        ]),
      },
    ];
    const sec = this._section("sec:graph", this._t("s_graph"));
    sec.body.appendChild(
      this._form({
        schema,
        getData: () => {
          const merged = { ...DEFAULTS, ...this._config };
          return Object.fromEntries(keys.map((k) => [k, merged[k]]));
        },
        onChange: (v) => this._emit(this._patch(keys, v)),
      })
    );
    return sec.d;
  }

  _buildHeaderActions() {
    const keys = ["tap_action", "tap_entity", "hold_action", "hold_entity"];
    const sec = this._section("sec:header", this._t("s_header_actions"));
    sec.body.appendChild(
      this._form({
        schema: [
          { name: "tap_action", selector: { ui_action: { default_action: "none" } } },
          { name: "tap_entity", selector: { entity: {} } },
          { name: "hold_action", selector: { ui_action: { default_action: "none" } } },
          { name: "hold_entity", selector: { entity: {} } },
        ],
        getData: () =>
          Object.fromEntries(keys.filter((k) => this._config[k] !== undefined).map((k) => [k, this._config[k]])),
        onChange: (v) => this._emit(this._patch(keys, v)),
      })
    );
    return sec.d;
  }

  _buildTemperature() {
    const sec = this._section("sec:temp", this._t("s_temp"));
    const get = () =>
      (this._config.temperature_thresholds || DEFAULT_TEMP_THRESHOLDS).map((x) => ({ ...x }));
    const set = (arr) => this._emit({ ...this._config, temperature_thresholds: arr });

    get().forEach((_, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.appendChild(
        this._form({
          schema: [
            {
              type: "grid", name: "",
              schema: [
                { name: "below", selector: { number: { mode: "box", step: 0.5, unit_of_measurement: "°C" } } },
                { name: "color", selector: colorSelect() },
              ],
            },
          ],
          getData: () => get()[i] || {},
          onChange: (v) => {
            const arr = get();
            arr[i] = { ...arr[i], ...v };
            set(arr);
          },
        })
      );
      row.appendChild(
        this._iconButton("mdi:delete", this._t("del"), () => {
          const arr = get();
          arr.splice(i, 1);
          set(arr);
        })
      );
      sec.body.appendChild(row);
    });

    sec.body.appendChild(
      this._button(this._t("add_threshold"), () => {
        const arr = get();
        const last = arr.length ? Math.max(...arr.map((x) => Number(x.below) || 0)) : 18;
        arr.push({ below: last + 2, color: "green" });
        set(arr);
      })
    );

    sec.body.appendChild(
      this._form({
        schema: [{ name: "temperature_default_color", selector: colorSelect() }],
        getData: () => ({
          temperature_default_color:
            this._config.temperature_default_color ?? DEFAULTS.temperature_default_color,
        }),
        onChange: (v) => this._emit(this._patch(["temperature_default_color"], v)),
      })
    );

    sec.body.appendChild(
      this._button(
        this._t("reset"),
        () => {
          const c = { ...this._config };
          delete c.temperature_thresholds;
          delete c.temperature_default_color;
          this._emit(c);
        },
        true
      )
    );
    return sec.d;
  }

  _buildHumidity() {
    const keys = [
      "humidity_low", "humidity_high", "humidity_low_color", "humidity_normal_color",
      "humidity_high_color", "show_humidity_badge", "show_humidity_emoji",
    ];
    const pct = { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } };
    const schema = [
      {
        type: "grid", name: "",
        schema: [
          { name: "humidity_low", selector: pct },
          { name: "humidity_high", selector: pct },
        ],
      },
      {
        type: "grid", name: "",
        schema: [
          { name: "humidity_low_color", selector: colorSelect() },
          { name: "humidity_normal_color", selector: colorSelect() },
          { name: "humidity_high_color", selector: colorSelect() },
        ],
      },
      {
        type: "grid", name: "",
        schema: [
          { name: "show_humidity_badge", selector: { boolean: {} } },
          { name: "show_humidity_emoji", selector: { boolean: {} } },
        ],
      },
    ];
    const sec = this._section("sec:hum", this._t("s_hum"));
    sec.body.appendChild(
      this._form({
        schema,
        getData: () => {
          const merged = { ...DEFAULTS, ...this._config };
          return Object.fromEntries(keys.map((k) => [k, merged[k]]));
        },
        onChange: (v) => this._emit(this._patch(keys, v)),
      })
    );
    return sec.d;
  }

  _buildRooms() {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.style.cssText = "font-weight:500;margin:0 0 8px;color:var(--primary-text-color)";
    title.textContent = this._t("s_rooms");
    wrap.appendChild(title);

    const rooms = () => (this._config.rooms || []).map((r) => ({ ...r }));
    const setRooms = (arr) => this._emit({ ...this._config, rooms: arr });
    const roomKeys = [
      "name", "short_name", "icon", "temperature_entity", "humidity_entity",
      "climate_entity", "battery_entity", "exclude_average", "humidity_low", "humidity_high",
      "tap_entity", "tap_action", "hold_entity", "hold_action",
    ];
    const total = rooms().length;

    rooms().forEach((_, i) => {
      const sec = this._section(`room:${i}`, "");
      const label = () =>
        (this._config.rooms?.[i]?.name) || `${this._t("s_rooms")} ${i + 1}`;
      sec.sp.textContent = label();
      this._syncers.push(() => (sec.sp.textContent = label()));

      if (i > 0) sec.s.appendChild(this._iconButton("mdi:arrow-up", this._t("up"), () => {
        const arr = rooms();
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        setRooms(arr);
      }));
      if (i < total - 1) sec.s.appendChild(this._iconButton("mdi:arrow-down", this._t("down"), () => {
        const arr = rooms();
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        setRooms(arr);
      }));
      sec.s.appendChild(this._iconButton("mdi:delete", this._t("del"), () => {
        const arr = rooms();
        arr.splice(i, 1);
        setRooms(arr);
      }));

      sec.body.appendChild(
        this._form({
          schema: [
            {
              type: "grid", name: "",
              schema: [
                { name: "name", selector: { text: {} } },
                { name: "short_name", selector: { text: {} } },
              ],
            },
            { name: "icon", selector: { icon: {} } },
            { name: "temperature_entity", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
            { name: "humidity_entity", selector: { entity: { domain: "sensor", device_class: "humidity" } } },
            { name: "climate_entity", selector: { entity: { domain: "climate" } } },
            { name: "battery_entity", selector: { entity: { domain: "sensor", device_class: "battery" } } },
            { name: "exclude_average", selector: { boolean: {} } },
            {
              type: "grid", name: "",
              schema: [
                { name: "humidity_low", selector: { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } } },
                { name: "humidity_high", selector: { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } } },
              ],
            },
            { name: "tap_entity", selector: { entity: {} } },
            { name: "tap_action", selector: { ui_action: { default_action: "more-info" } } },
            { name: "hold_entity", selector: { entity: {} } },
            { name: "hold_action", selector: { ui_action: { default_action: "none" } } },
          ],
          getData: () => {
            const r = this._config.rooms?.[i] || {};
            return Object.fromEntries(roomKeys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
          },
          onChange: (v) => {
            const arr = rooms();
            const base = { ...arr[i] };
            roomKeys.forEach((k) => delete base[k]);
            const next = clean({ ...base, ...v });
            if (next.exclude_average === false) delete next.exclude_average;
            arr[i] = next;
            setRooms(arr);
          },
          helpPrefix: "room_",
        })
      );
      wrap.appendChild(sec.d);
    });

    wrap.appendChild(
      this._button(this._t("add_room"), () => {
        const arr = rooms();
        this._open.add(`room:${arr.length}`);
        arr.push({ name: this._t("new_room") });
        setRooms(arr);
      })
    );
    return wrap;
  }
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                      */
/* ------------------------------------------------------------------ */

customElements.define(CARD_TAG, ClimascopeCard);
if (!customElements.get(LEGACY_TAG)) customElements.define(LEGACY_TAG, class extends ClimascopeCard {});
customElements.define(EDITOR_TAG, ClimascopeCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: "Climascope",
  description: "Home average, outdoor temperature and room tiles (temperature, humidity, heating) with thresholds, trends and history.",
  documentationURL: "https://github.com/Geoffrey33/Climascope",
  preview: true,
});

console.info(
  `%c CLIMASCOPE-CARD %c v${VERSION} `,
  "color:#fff;background:#03a9f4;font-weight:700;",
  "color:#03a9f4;background:#fff;font-weight:700;"
);
