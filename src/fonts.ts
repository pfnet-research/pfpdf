/** FontResolver: bundled fonts plus opt-in host font directories. */
import fs from 'node:fs';
import path from 'node:path';
import { InputError, RuntimeError } from './errors.js';
import { rewriteCss, type ResourceManifest } from './resources.js';
import { resourcePath } from './template.js';

export interface FontResolution {
  /** Combined @font-face CSS with logical URLs. */
  css: string;
  warnings: string[];
  /** Per-file details which are useful at debug log level but too noisy normally. */
  diagnostics: string[];
}

class FontMessages {
  readonly warnings: string[] = [];
  readonly diagnostics: string[] = [];
  private restrictedHostFaces = 0;
  private duplicateHostFaces = 0;

  expectedSkip(explicit: boolean, kind: 'restricted' | 'duplicate', message: string): void {
    if (explicit) {
      this.warnings.push(message);
      return;
    }
    this.diagnostics.push(message);
    if (kind === 'restricted') {
      this.restrictedHostFaces++;
    } else {
      this.duplicateHostFaces++;
    }
  }

  finish(): void {
    if (this.restrictedHostFaces > 0) {
      this.warnings.push(`${this.restrictedHostFaces} host font face(s) excluded because embedding is restricted`);
    }
    if (this.duplicateHostFaces > 0) {
      this.warnings.push(`${this.duplicateHostFaces} duplicate host font face(s) ignored`);
    }
  }
}

const MACOS_FONT_DIRS = [
  ...(process.env.HOME ? [path.join(process.env.HOME, 'Library/Fonts')] : []),
  '/Library/Fonts',
  '/System/Library/Fonts',
  '/System/Library/Fonts/Supplemental',
];
const LINUX_FONT_DIRS = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  ...(process.env.HOME ? [path.join(process.env.HOME, '.fonts')] : []),
];
const WINDOWS_FONT_DIRS = [
  ...(process.env.WINDIR ? [path.join(process.env.WINDIR, 'Fonts')] : []),
  ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : []),
];

export function resolveFonts(manifest: ResourceManifest, fontDirsAbs: string[], hostFonts: boolean): FontResolution {
  const messages = new FontMessages();
  const warnings = messages.warnings;
  let css = '';
  // Bundled fonts: @fontsource CSS files copied into resources/fonts.
  const bundledCssDir = resourcePath('fonts');
  const bundledCssFiles = fs
    .readdirSync(bundledCssDir)
    .filter((n) => n.endsWith('.css'))
    .sort();
  for (const name of bundledCssFiles) {
    try {
      css += rewriteCss(path.join(bundledCssDir, name), manifest, () => '') + '\n';
    } catch (e) {
      throw new RuntimeError(`bundled font resource is broken: ${(e as Error).message}`);
    }
  }

  const dirs: Array<{ path: string; explicit: boolean }> = fontDirsAbs.map((dir) => ({ path: dir, explicit: true }));
  if (hostFonts) {
    const osDirs = process.platform === 'darwin'
      ? MACOS_FONT_DIRS
      : process.platform === 'win32'
        ? WINDOWS_FONT_DIRS
        : LINUX_FONT_DIRS;
    for (const d of osDirs) if (fs.existsSync(d)) dirs.push({ path: d, explicit: false });
  }

  const seenFiles = new Set<string>();
  const seenFaces = new Set<string>();
  const seenDirs = new Set<string>();
  for (const candidate of dirs) {
    const dir = candidate.path;
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
      if (!fs.statSync(realDir).isDirectory()) throw new Error('not a directory');
    } catch (e) {
      if (candidate.explicit) throw new InputError(`font directory not found: ${dir}`);
      warnings.push(`host font directory ignored: ${dir}: ${(e as Error).message}`);
      continue;
    }
    if (seenDirs.has(realDir)) {
      warnings.push(`duplicate font directory ignored: ${dir}`);
      continue;
    }
    seenDirs.add(realDir);
    let fontFiles: string[];
    try {
      fontFiles = [...walkFontFiles(realDir)];
    } catch (e) {
      if (candidate.explicit) {
        throw new InputError(`cannot scan font directory ${dir}: ${(e as Error).message}`);
      }
      warnings.push(`cannot scan host font directory ${dir}: ${(e as Error).message}`);
      continue;
    }
    for (const file of fontFiles) {
      let real: string;
      try {
        real = fs.realpathSync(file);
      } catch {
        continue;
      }
      if (seenFiles.has(real)) continue;
      seenFiles.add(real);
      if (/\.woff2$/i.test(file)) {
        warnings.push(`unsupported font format ignored (WOFF2 metadata inspection is unavailable): ${file}`);
        continue;
      }
      try {
        const faces = parseFontFile(real);
        for (const face of faces) {
          if (face.restricted) {
            const message = `font excluded (embedding restricted by OS/2 fsType): ${file}`;
            messages.expectedSkip(candidate.explicit, 'restricted', message);
            continue;
          }
          const key = `${face.family}|${face.weight}|${face.style}`;
          if (seenFaces.has(key)) {
            const message = `duplicate font face ignored: ${file} (${face.family} ${face.weight} ${face.style})`;
            messages.expectedSkip(candidate.explicit, 'duplicate', message);
            continue;
          }
          seenFaces.add(key);
          const logical = manifest.add(real);
          css += `@font-face { font-family: ${cssString(face.family)}; src: url(${cssString(logical)}); ` +
            `font-weight: ${face.weight}; font-style: ${face.style}; }\n`;
        }
      } catch (e) {
        if (candidate.explicit) {
          throw new InputError(`cannot use font file ${file}: ${(e as Error).message}`);
        }
        warnings.push(`cannot use host font file ${file}: ${(e as Error).message}`);
      }
    }
  }

  messages.finish();
  return { css, warnings, diagnostics: messages.diagnostics };
}

function cssString(s: string): string {
  let escaped = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\' || ch === '"') escaped += `\\${ch}`;
    else if (cp < 0x20 || cp === 0x7f) escaped += `\\${cp.toString(16)} `;
    else escaped += ch;
  }
  return `"${escaped}"`;
}

function* walkFontFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort(
    (a, b) => Buffer.from(a.name, 'utf8').compare(Buffer.from(b.name, 'utf8')),
  );
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFontFiles(full);
    } else if (/\.(ttf|otf|ttc|woff2)$/i.test(entry.name)) {
      yield full;
    }
  }
}

interface FontFace {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  restricted: boolean;
}

/** Minimal sfnt parser: name table family, OS/2 weight and fsType. */
function parseFontFile(file: string): FontFace[] {
  const buf = fs.readFileSync(file);
  if (buf.length < 12) throw new Error('font header is truncated');
  const faces: FontFace[] = [];
  const tag = buf.readUInt32BE(0);
  if (tag === 0x74746366) {
    // 'ttcf'
    const count = buf.readUInt32BE(8);
    if (count > 4096) throw new Error('unreasonable TTC face count');
    if (12 + count * 4 > buf.length) throw new Error('TTC offset table is truncated');
    for (let i = 0; i < count; i++) {
      const offset = buf.readUInt32BE(12 + 4 * i);
      const face = parseSfnt(buf, offset);
      if (face) faces.push(face);
    }
  } else {
    const face = parseSfnt(buf, 0);
    if (face) faces.push(face);
  }
  return faces;
}

function parseSfnt(buf: Buffer, offset: number): FontFace | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 12 > buf.length) {
    throw new Error('sfnt header offset out of range');
  }
  const version = buf.readUInt32BE(offset);
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
    throw new Error('not a recognized sfnt font');
  }
  const numTables = buf.readUInt16BE(offset + 4);
  if (numTables > 4096) throw new Error('unreasonable table count');
  const tables = new Map<string, { off: number; len: number }>();
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + 16 * i;
    if (rec + 16 > buf.length) throw new Error('table directory out of range');
    const t = buf.toString('latin1', rec, rec + 4);
    const off = buf.readUInt32BE(rec + 8);
    const len = buf.readUInt32BE(rec + 12);
    if (off > buf.length || len > buf.length - off) throw new Error('table out of range');
    tables.set(t, { off, len });
  }
  const nameTable = tables.get('name');
  if (!nameTable) throw new Error('missing name table');
  const family = readName(buf, nameTable.off, nameTable.len, 16) ?? readName(buf, nameTable.off, nameTable.len, 1);
  if (!family) throw new Error('no family name');
  const sub = readName(buf, nameTable.off, nameTable.len, 17) ?? readName(buf, nameTable.off, nameTable.len, 2) ?? '';
  let weight = 400;
  let restricted = false;
  const os2 = tables.get('OS/2');
  if (os2 && os2.len >= 10) {
    weight = buf.readUInt16BE(os2.off + 4);
    const fsType = buf.readUInt16BE(os2.off + 8);
    // Restricted-license and bitmap-only embedding both prohibit embedding the
    // outline data used by Chromium when producing this PDF.
    restricted = (fsType & 0x0002) !== 0 || (fsType & 0x0200) !== 0;
    if (weight < 1 || weight > 1000) weight = 400;
  }
  const style: 'normal' | 'italic' = /italic|oblique/i.test(sub) ? 'italic' : 'normal';
  return { family, weight, style, restricted };
}

function readName(buf: Buffer, off: number, len: number, nameId: number): string | null {
  if (len < 6) return null;
  const count = buf.readUInt16BE(off + 2);
  const relativeStringOffset = buf.readUInt16BE(off + 4);
  if (relativeStringOffset > len) throw new Error('name string offset out of range');
  const stringOffset = off + relativeStringOffset;
  let best: string | null = null;
  for (let i = 0; i < count; i++) {
    const rec = off + 6 + 12 * i;
    if (rec + 12 > off + len) break;
    const platformId = buf.readUInt16BE(rec);
    const id = buf.readUInt16BE(rec + 6);
    if (id !== nameId) continue;
    const length = buf.readUInt16BE(rec + 8);
    const strOff = stringOffset + buf.readUInt16BE(rec + 10);
    if (strOff < stringOffset || strOff > off + len || length > off + len - strOff) continue;
    if (platformId === 3 || platformId === 0) {
      // UTF-16BE
      if (length % 2 !== 0) continue;
      best = Buffer.from(buf.subarray(strOff, strOff + length)).swap16().toString('utf16le');
      if (/\0|[\u0001-\u001F\u007F-\u009F]/.test(best)) throw new Error('font family contains control characters');
      if (platformId === 3) return best;
    } else if (platformId === 1 && best === null) {
      best = buf.toString('latin1', strOff, strOff + length);
      if (/\0|[\u0001-\u001F\u007F-\u009F]/.test(best)) throw new Error('font family contains control characters');
    }
  }
  return best;
}
