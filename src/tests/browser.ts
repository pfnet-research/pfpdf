/** Test automation is resolved from the pinned renderer, without another dependency. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import type * as Puppeteer from 'puppeteer-core';
import { resolveVivliostyleCli } from '../renderer.js';

export async function openTestBrowser(): Promise<Puppeteer.Browser> {
  const require = createRequire(resolveVivliostyleCli());
  const puppeteer = require('puppeteer-core') as typeof Puppeteer;
  let executablePath = process.env.BROWSER_PATH;
  if (!executablePath && process.platform === 'linux' && process.arch === 'arm64' && fs.existsSync('/usr/bin/chromium')) executablePath = '/usr/bin/chromium';
  if (!executablePath) {
    const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches')
      : process.platform === 'win32' ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
        : process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
    for (const cacheDir of [path.join(base, 'vivliostyle', 'browsers'), '/opt/puppeteer']) {
      const candidates = await getInstalledBrowsers({ cacheDir });
      if (candidates[0]) { executablePath = candidates[0].executablePath; break; }
    }
  }
  if (!executablePath) throw new Error('render a PDF first or set BROWSER_PATH before browser layout checks');
  return puppeteer.launch({ executablePath, headless: true });
}

export function pdfLineWidths(xml: string, marker: string): number[] {
  const result: number[] = [];
  for (const line of xml.matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)) {
    if (!line[2]!.includes(marker)) continue;
    const left = /xMin="([\d.]+)"/.exec(line[1]!);
    const right = /xMax="([\d.]+)"/.exec(line[1]!);
    if (left && right) result.push(Number(right[1]) - Number(left[1]));
  }
  return result;
}
