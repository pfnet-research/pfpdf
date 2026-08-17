// Deterministically generate the pfn template cover artwork (pure vector SVG).
//
// The SVG owns the visible backdrop gradient so PDF renderers receive one
// simple colour field. The matching CSS gradient is a loading fallback.
//
// usage: node scripts/generate-pfn-cover-art.mjs
//   Regenerates resources/templates/pfn/cover-art.svg.
// usage: node scripts/generate-pfn-cover-art.mjs --preview [OUTPUT_DIR]
//   Writes wovenAiryCanopy.svg without replacing the bundled asset.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLED_PATH = path.join(root, 'resources', 'templates', 'pfn', 'cover-art.svg');

// A4 with 13mm bleed on every side (matches the print header::before overhang).
const BLEED = 13;
const W = 210;
const H = 297;
const X0 = -BLEED;
const Y0 = -BLEED;
const VW = W + BLEED * 2;
const VH = H + BLEED * 2;

// Tune the current design here. Geometry values are millimetres in the A4
// coordinate space. Keep the title band around y=120..190 visually quiet.
const DESIGN = {
  name: 'wovenAiryCanopy',
  backdrop: {
    start: '#111b64',
    middle: '#19438f',
    end: '#1b75b4',
    middleOffset: 0.52,
  },
  mesh: {
    seed: 20260809,
    spanX: 236,
    spanY: 162,
    fadeSpanX: 260,
    fadeSpanY: 122,
    density: 0.64,
    core: 0.27,
    lineOpacity: 0.16,
    lineWidth: 0.25,
    nodeOpacity: 0.26,
    nodeScale: 0.82,
    accent: '#9fd9ff',
  },
  waves: {
    verticalScale: 0.8,
    widthScale: 0.5,
    fadeColor: '#d9efff',
    families: [
      {
        count: 7,
        base: 220,
        baseStep: 10,
        amplitude: 7.5,
        amplitudeStep: 1.05,
        phase: 0.08,
        phaseStep: 0.58,
        drift: 58,
        cycles: 0.78,
        opacity: 0.11,
      },
      {
        count: 6,
        base: 235,
        baseStep: 11,
        amplitude: 9,
        amplitudeStep: 1.2,
        phase: 2.4,
        phaseStep: -0.54,
        drift: -58,
        cycles: 0.74,
        opacity: 0.09,
      },
    ],
  },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (x) => Number(x.toFixed(2));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// --- Delaunay triangulation (Bowyer-Watson) -------------------------------

function circumcircle(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x: ux, y: uy, r2: (a.x - ux) ** 2 + (a.y - uy) ** 2 };
}

function delaunay(points) {
  const superTriangle = [
    { x: -1e4, y: -1e4 },
    { x: 3e4, y: -1e4 },
    { x: -1e4, y: 3e4 },
  ];
  const pts = points.concat(superTriangle);
  const n = points.length;
  let triangles = [{ i: n, j: n + 1, k: n + 2 }];
  for (let p = 0; p < n; p++) {
    const bad = [];
    for (const triangle of triangles) {
      const circle = circumcircle(pts[triangle.i], pts[triangle.j], pts[triangle.k]);
      if (circle && (pts[p].x - circle.x) ** 2 + (pts[p].y - circle.y) ** 2 <= circle.r2) {
        bad.push(triangle);
      }
    }
    const edges = new Map();
    for (const triangle of bad) {
      for (const [u, v] of [[triangle.i, triangle.j], [triangle.j, triangle.k], [triangle.k, triangle.i]]) {
        const key = u < v ? `${u}-${v}` : `${v}-${u}`;
        edges.set(key, edges.has(key) ? null : [u, v]);
      }
    }
    triangles = triangles.filter((triangle) => !bad.includes(triangle));
    for (const edge of edges.values()) {
      if (edge) triangles.push({ i: edge[0], j: edge[1], k: p });
    }
  }
  return triangles.filter((triangle) => triangle.i < n && triangle.j < n && triangle.k < n);
}

function meshEdges(triangles) {
  const seen = new Set();
  const edges = [];
  for (const triangle of triangles) {
    for (const [u, v] of [[triangle.i, triangle.j], [triangle.j, triangle.k], [triangle.k, triangle.i]]) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([u, v]);
      }
    }
  }
  return edges;
}

// Minimum-distance dart throwing avoids the long, nearly collinear chains
// produced by a jittered grid. Points extend beyond the visible fade boundary
// so the triangulation disappears before its geometry ends.
function meshPoints(rand, config) {
  const points = [];
  const step = 16 / Math.sqrt(config.density);
  const target = Math.round((config.spanX * config.spanY * 1.55) / step ** 2);
  const minDistance = step * 0.52;
  for (let attempt = 0; attempt < target * 180 && points.length < target; attempt++) {
    const x = -16 + rand() * (config.spanX * 1.18 + 16);
    const y = -16 + rand() * (config.spanY * 1.18 + 16);
    if (Math.hypot((x + 8) / config.spanX, (y + 8) / config.spanY) > 1.2) continue;
    if (points.some((point) => Math.hypot(x - point.x, y - point.y) < minDistance)) continue;
    points.push({ x, y });
  }
  return { points, step };
}

function cornerMesh() {
  const config = DESIGN.mesh;
  const rand = mulberry32(config.seed);
  const { points, step } = meshPoints(rand, config);
  const edges = meshEdges(delaunay(points));
  const falloff = (x, y) => {
    const radius = Math.hypot((x + 8) / config.fadeSpanX, (y + 8) / config.fadeSpanY);
    const t = clamp((1 - radius) / (1 - config.core), 0, 1);
    return t * t * (3 - 2 * t);
  };

  let svg = '';
  for (const [u, v] of edges) {
    const [a, b] = [points[u], points[v]];
    if (Math.hypot(a.x - b.x, a.y - b.y) > step * 2.2) continue;
    const fade = falloff((a.x + b.x) / 2, (a.y + b.y) / 2);
    const opacity = config.lineOpacity * fade ** 1.25 * (0.76 + rand() * 0.42);
    if (opacity < 0.012) continue;
    const width = config.lineWidth * (0.3 + 0.7 * fade);
    svg += `<path d="M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}" stroke="#fff" stroke-opacity="${fmt(opacity)}" stroke-width="${fmt(width)}" fill="none"/>\n`;
  }
  for (const point of points) {
    const fade = falloff(point.x, point.y);
    const opacity = config.nodeOpacity * fade ** 1.15 * (0.78 + rand() * 0.38);
    if (opacity < 0.025) continue;
    const radius = config.nodeScale * (0.28 + 0.38 * fade) * (0.82 + rand() * 0.35);
    const color = rand() < 0.13 ? config.accent : '#fff';
    svg += `<circle cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="${fmt(radius)}" fill="${color}" fill-opacity="${fmt(opacity)}"/>\n`;
  }
  return svg;
}

function backdrop() {
  const { start, middle, end, middleOffset } = DESIGN.backdrop;
  const fadeColor = DESIGN.waves.fadeColor;
  return `<defs>
<linearGradient id="pfncover-backdrop" x1="${X0}" y1="${Y0}" x2="${W + BLEED}" y2="${H + BLEED}" gradientUnits="userSpaceOnUse" color-interpolation="sRGB">
<stop offset="0" stop-color="${start}"/>
<stop offset="${middleOffset}" stop-color="${middle}"/>
<stop offset="1" stop-color="${end}"/>
</linearGradient>
<linearGradient id="pfncover-wave-fade" x1="${X0}" y1="0" x2="${W + BLEED}" y2="0" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${fadeColor}" stop-opacity="0"/>
<stop offset="0.18" stop-color="${fadeColor}" stop-opacity="0.82"/>
<stop offset="0.72" stop-color="${fadeColor}" stop-opacity="0.9"/>
<stop offset="1" stop-color="${fadeColor}" stop-opacity="0"/>
</linearGradient>
</defs>
<rect x="${X0}" y="${Y0}" width="${VW}" height="${VH}" fill="url(#pfncover-backdrop)"/>
`;
}

// Catmull-Rom converted to cubic Bezier. Adjacent segments share a tangent,
// so no corners appear at joins even at print resolution.
function catmullRomPath(points) {
  let d = `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d;
}

function wavePoints(spec) {
  const count = 9;
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return {
      x: X0 + t * VW,
      y: spec.base + spec.drift * (t - 0.5) + spec.amplitude * Math.sin(spec.phase + t * Math.PI * 2 * spec.cycles),
    };
  });
}

function wovenLines() {
  const config = DESIGN.waves;
  const verticalAnchor = H + BLEED;
  let svg = '';
  for (const family of config.families) {
    for (let i = 0; i < family.count; i++) {
      const emphasis = i === Math.floor(family.count / 2);
      const points = wavePoints({
        base: family.base + i * family.baseStep,
        amplitude: family.amplitude + i * family.amplitudeStep,
        phase: family.phase + i * family.phaseStep,
        drift: family.drift,
        cycles: family.cycles,
      }).map((point) => ({
        x: point.x,
        y: verticalAnchor - (verticalAnchor - point.y) * config.verticalScale,
      }));
      const opacity = family.opacity + i * 0.018 + (emphasis ? 0.07 : 0);
      const width = (emphasis ? 0.62 : 0.3 + i * 0.04) * config.widthScale;
      svg += `<path d="${catmullRomPath(points)}" fill="none" stroke="url(#pfncover-wave-fade)" stroke-opacity="${fmt(opacity)}" stroke-width="${fmt(width)}"/>\n`;
    }
  }
  return svg;
}

function artwork() {
  const body = backdrop() + wovenLines() + cornerMesh();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X0} ${Y0} ${VW} ${VH}" preserveAspectRatio="xMidYMid slice">\n${body}</svg>\n`;
}

function emit(file) {
  const banner = `<!-- generated by scripts/generate-pfn-cover-art.mjs (variant: ${DESIGN.name}); do not edit by hand -->\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, banner + artwork());
  console.log(`${file}: ${fs.statSync(file).size} bytes`);
}

const args = process.argv.slice(2);
if (args[0] === '--preview' && args.length <= 2) {
  const outDir = args[1] ?? path.join(root, 'build', 'artwork');
  emit(path.join(outDir, `${DESIGN.name}.svg`));
} else if (args.length === 0) {
  emit(BUNDLED_PATH);
} else {
  console.error('usage: node scripts/generate-pfn-cover-art.mjs [--preview [OUTPUT_DIR]]');
  process.exit(2);
}
