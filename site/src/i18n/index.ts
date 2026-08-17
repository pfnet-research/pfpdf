import { en } from './en';
import { ja } from './ja';

export type Locale = 'en' | 'ja';
export const locales: Locale[] = ['en', 'ja'];

export function t(locale: Locale) {
  return locale === 'ja' ? ja : en;
}

/** Root-relative path prefix for a locale ("/" or "/ja/"). */
export function localeRoot(locale: Locale): string {
  return locale === 'ja' ? '/ja/' : '/';
}

/** The same page in the other locale (adds or removes the /ja prefix). */
export function alternatePath(locale: Locale, rootRelativePath: string): string {
  return locale === 'ja'
    ? rootRelativePath.replace(/^\/ja(\/|$)/, '/')
    : `/ja${rootRelativePath}`;
}
