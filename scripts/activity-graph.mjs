#!/usr/bin/env node
// Builds a self-hosted contribution activity graph (light + dark SVG) from the
// GitHub GraphQL contribution calendar. No third-party service involved, so the
// README image can't break when someone else's free deployment goes down.
//
// Usage: GITHUB_TOKEN=... GITHUB_USER=muhammad-rafey node scripts/activity-graph.mjs [outDir]

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_USER;
const outDir = process.argv[2] ?? "dist";
const DAYS = 31;

if (!token || !login) {
  console.error("GITHUB_TOKEN and GITHUB_USER are required");
  process.exit(1);
}

const query = `query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-activity-graph" },
  body: JSON.stringify({ query, variables: { login } }),
});
const json = await res.json();
if (!res.ok || json.errors) {
  console.error(JSON.stringify(json.errors ?? json, null, 2));
  process.exit(1);
}

const cal = json.data.user.contributionsCollection.contributionCalendar;
const all = cal.weeks.flatMap((w) => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
const days = all.slice(-DAYS);

// Stats
const last = days.reduce((s, d) => s + d.contributionCount, 0);
const best = days.reduce((m, d) => (d.contributionCount > m.contributionCount ? d : m), days[0]);
let streak = 0;
for (let i = all.length - 1; i >= 0; i--) {
  if (all[i].contributionCount > 0) streak++;
  else if (i === all.length - 1) continue; // today isn't over yet
  else break;
}
let longest = 0;
for (let i = 0, run = 0; i < all.length; i++) {
  run = all[i].contributionCount > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
}

// Geometry
const W = 860, H = 340;
const pad = { l: 56, r: 28, t: 110, b: 44 };
const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
const max = Math.max(4, ...days.map((d) => d.contributionCount));
const niceMax = Math.ceil(max / 4) * 4;
const x = (i) => pad.l + (i / (days.length - 1)) * cw;
const y = (v) => pad.t + ch - (v / niceMax) * ch;
const pts = days.map((d, i) => [x(i), y(d.contributionCount)]);

// Smooth Catmull-Rom -> cubic Bézier, clamped so the curve never dips below 0
function smooth(p) {
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  const floor = y(0);
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
const line = smooth(pts);
const area = `${line} L${x(days.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

const fmt = (iso, opts) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const themes = {
  light: { bg: "#ffffff", border: "#d0d7de", text: "#1f2328", muted: "#656d76", grid: "#eaeef2", a: "#8b5cf6", b: "#06b6d4", dot: "#ffffff", chip: "#f6f8fa" },
  dark: { bg: "#0d1117", border: "#30363d", text: "#e6edf3", muted: "#8d96a0", grid: "#21262d", a: "#a78bfa", b: "#22d3ee", dot: "#0d1117", chip: "#161b22" },
};

// SMIL fade: renderers without animation support just show the final, fully-visible state
const fadeIn = (delay, dur = 0.5) => {
  const total = delay + dur, k = (delay / total).toFixed(3);
  return `<animate attributeName="opacity" values="0;0;1" keyTimes="0;${k};1" dur="${total.toFixed(2)}s" fill="freeze"/>`;
};

function render(t) {
  const grid = [0, 1, 2, 3, 4].map((k) => {
    const v = (niceMax / 4) * k, gy = y(v);
    return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${gy}" y2="${gy}" stroke="${t.grid}" stroke-dasharray="${k ? "3 5" : "0"}"/>` +
      `<text x="${pad.l - 14}" y="${gy + 4}" text-anchor="end" class="axis">${v}</text>`;
  }).join("");
  const xLabels = days.map((d, i) => (i % 5 === 0 || i === days.length - 1)
    ? `<text x="${x(i)}" y="${H - pad.b + 24}" text-anchor="middle" class="axis">${fmt(d.date, { month: "short", day: "numeric" })}</text>` : "").join("");
  const dots = pts.map(([px, py], i) =>
    `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${days[i].date === best.date && best.contributionCount ? 5.5 : 3.5}" fill="${t.dot}" stroke="url(#stroke)" stroke-width="2.5" >${fadeIn(0.9 + i * 0.03)}<title>${esc(fmt(days[i].date, { month: "short", day: "numeric" }))}: ${days[i].contributionCount} contributions</title></circle>`).join("");

  const stats = [
    [cal.totalContributions.toLocaleString("en-US"), "past year"],
    [last.toLocaleString("en-US"), `last ${DAYS} days`],
    [`${streak}d`, "current streak"],
    [`${longest}d`, "longest streak"],
  ];
  const chipW = 132, gap = 10, startX = W - pad.r - stats.length * chipW - (stats.length - 1) * gap;
  const chips = stats.map(([v, l], i) => {
    const cx = startX + i * (chipW + gap);
    return `<g>${fadeIn(0.1 + i * 0.08)}<rect x="${cx}" y="26" width="${chipW}" height="56" rx="10" fill="${t.chip}" stroke="${t.border}"/>` +
      `<text x="${cx + 14}" y="52" class="num">${esc(v)}</text><text x="${cx + 14}" y="70" class="lbl">${esc(l)}</text></g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(login)} contribution activity, last ${DAYS} days: ${last} contributions">
<defs>
  <linearGradient id="stroke" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${t.a}"/><stop offset="1" stop-color="${t.b}"/></linearGradient>
  <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${t.a}" stop-opacity=".32"/><stop offset="1" stop-color="${t.b}" stop-opacity="0"/></linearGradient>
  <clipPath id="reveal"><rect x="0" y="0" width="${W}" height="${H}"><animate attributeName="width" from="0" to="${W}" dur="1.4s" fill="freeze" calcMode="spline" keySplines=".4 0 .2 1" keyTimes="0;1"/></rect></clipPath>
</defs>
<style>
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
  .title { font-size: 20px; font-weight: 700; fill: ${t.text}; }
  .sub { font-size: 13px; fill: ${t.muted}; }
  .axis { font-size: 11px; fill: ${t.muted}; }
  .num { font-size: 19px; font-weight: 700; fill: ${t.text}; }
  .lbl { font-size: 11px; fill: ${t.muted}; }
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
<text x="28" y="50" class="title">Contribution activity</text>
<text x="28" y="72" class="sub">${esc(fmt(days[0].date, { month: "short", day: "numeric" }))} – ${esc(fmt(days.at(-1).date, { month: "short", day: "numeric", year: "numeric" }))}</text>
${chips}
${grid}
${xLabels}
<g clip-path="url(#reveal)">
  <path d="${area}" fill="url(#fill)"/>
  <path d="${line}" fill="none" stroke="url(#stroke)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</g>
${dots}
</svg>
`;
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "activity-graph.svg"), render(themes.light));
await writeFile(join(outDir, "activity-graph-dark.svg"), render(themes.dark));
console.log(`Wrote activity graph: ${last} contributions in last ${DAYS} days, ${cal.totalContributions} past year, streak ${streak}d`);
