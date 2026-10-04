import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const series = JSON.parse(readFileSync(resolve(here, "stability-series.json"), "utf8"));
const outDir = resolve(here, "../../docs/images/yield-stability");
mkdirSync(outDir, { recursive: true });

const W = 880;
const H = 420;
const PAD = { top: 78, right: 28, bottom: 52, left: 64 };

function fmt(n, digits = 1) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function chart({ file, title, subtitle, seriesLines, yDigits = 0 }) {
  const all = seriesLines.flatMap((line) => line.points);
  const apys = all.map((point) => point.apy);
  const times = all.map((point) => new Date(point.ts).getTime());
  const minApy = Math.min(...apys);
  const maxApy = Math.max(...apys);
  const pad = (maxApy - minApy) * 0.12 || 0.5;
  const y0 = Math.max(0, minApy - pad);
  const y1 = maxApy + pad;
  const x0 = Math.min(...times);
  const x1 = Math.max(...times);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (ts) => PAD.left + ((new Date(ts).getTime() - x0) / (x1 - x0)) * plotW;
  const y = (apy) => PAD.top + (1 - (apy - y0) / (y1 - y0)) * plotH;

  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => y0 + ((y1 - y0) * i) / yTicks);
  const dayMs = 86_400_000;
  const xTicks = [];
  const startDay = new Date(x0);
  startDay.setUTCHours(0, 0, 0, 0);
  for (let t = startDay.getTime(); t <= x1; t += dayMs) {
    const date = new Date(t);
    if (date.getUTCDate() % 7 === 4 || date.getUTCDate() === 1) {
      xTicks.push(t);
    }
  }

  const grids = yLabels
    .map((value) => {
      const yy = y(value).toFixed(1);
      return `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" stroke="#e7e5e4" stroke-width="1"/>
        <text x="${PAD.left - 10}" y="${yy}" text-anchor="end" dominant-baseline="middle" fill="#78716c" font-size="12">${fmt(value, yDigits)}%</text>`;
    })
    .join("");

  const xLabels = xTicks
    .map((t) => {
      const date = new Date(t);
      const label = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      return `<text x="${x(new Date(t).toISOString()).toFixed(1)}" y="${H - 18}" text-anchor="middle" fill="#78716c" font-size="12">${label}</text>`;
    })
    .join("");

  const paths = seriesLines
    .map((line) => {
      const d = line.points
        .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.ts).toFixed(1)},${y(point.apy).toFixed(1)}`)
        .join("");
      const mean = line.points.reduce((sum, point) => sum + point.apy, 0) / line.points.length;
      const meanY = y(mean).toFixed(1);
      return `<path d="${d}" fill="none" stroke="${line.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
        <line x1="${PAD.left}" y1="${meanY}" x2="${W - PAD.right}" y2="${meanY}" stroke="${line.color}" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>`;
    })
    .join("");

  const legend = seriesLines
    .map((line, index) => {
      const lx = PAD.left + index * 240;
      const mean = line.points.reduce((sum, point) => sum + point.apy, 0) / line.points.length;
      return `<rect x="${lx}" y="40" width="14" height="3" fill="${line.color}"/>
        <text x="${lx + 20}" y="44" fill="#44403c" font-size="12">${line.name} · mean ${fmt(mean, 2)}%</text>`;
    })
    .join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
  <title>${title}</title>
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${PAD.left}" y="22" fill="#1c1917" font-size="16" font-family="ui-sans-serif, system-ui, sans-serif">${title}</text>
  <g font-family="ui-sans-serif, system-ui, sans-serif">
    ${legend}
    ${grids}
    ${paths}
    ${xLabels}
  </g>
</svg>
`;
  writeFileSync(resolve(outDir, file), svg);
}

const subtitle = "";

function points(id) {
  return series[id].points;
}

chart({
  file: "usdc-algo-lp.svg",
  title: "Tinyman USDC/ALGO LP fee APY",
  subtitle,
  yDigits: 0,
  seriesLines: [
    {
      name: "Fee APY",
      color: "#0f766e",
      points: points("2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM:lp")
    }
  ]
});

chart({
  file: "talgo-usdc.svg",
  title: "Tinyman TALGO/USDC, fee LP and farm",
  subtitle,
  yDigits: 0,
  seriesLines: [
    {
      name: "Fee LP",
      color: "#0f766e",
      points: points("VVBWRAJ3YSZGXBGJ2K654J3WA2VZOJW5U4SJCZWLM634H572WTGWTT53EE:lp")
    },
    {
      name: "Farm",
      color: "#b45309",
      points: points("VVBWRAJ3YSZGXBGJ2K654J3WA2VZOJW5U4SJCZWLM634H572WTGWTT53EE:farm")
    }
  ]
});

chart({
  file: "tiny-usdc-farm.svg",
  title: "Tinyman TINY/USDC farm APY",
  subtitle,
  yDigits: 0,
  seriesLines: [
    {
      name: "Farm APY",
      color: "#0f766e",
      points: points("UC4AUDFKY7KMFWABG2F47WAS32MBDIJ4HJ6RDCJHSZBOVVWGANCWWOGWGQ:farm")
    }
  ]
});

chart({
  file: "folks-usdc.svg",
  title: "Folks Finance USDC supply APY",
  subtitle,
  yDigits: 0,
  seriesLines: [
    {
      name: "Supply APY",
      color: "#0f766e",
      points: points("folks-lending-971372237")
    }
  ]
});

chart({
  file: "reti-staking.svg",
  title: "Reti ALGO staking APY",
  subtitle,
  yDigits: 2,
  seriesLines: [
    {
      name: "Staking APY",
      color: "#0f766e",
      points: points("reti-staking-159")
    }
  ]
});

console.log("wrote", outDir);
