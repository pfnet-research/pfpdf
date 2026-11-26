import fs from 'node:fs';
import { resourcePath } from '../template.js';

/** A bundled template's style.css with the theme.css it shares with its slide variant. */
export function templateStyle(template: string): string {
  const theme = resourcePath('templates', template, 'theme.css');
  return [
    ...(fs.existsSync(theme) ? [fs.readFileSync(theme, 'utf8')] : []),
    fs.readFileSync(resourcePath('templates', template, 'style.css'), 'utf8'),
  ].join('\n');
}

/** The shared structural styles followed by a bundled template's own stylesheet. */
export function bundledCss(template: string, file: 'style.css' | 'vivliostyle.css'): string {
  const common = file === 'style.css' ? 'common.css' : 'common-vivliostyle.css';
  return [
    fs.readFileSync(resourcePath('templates', common), 'utf8'),
    file === 'style.css' ? templateStyle(template) : fs.readFileSync(resourcePath('templates', template, file), 'utf8'),
  ].join('\n');
}
