declare module '@citation-js/core' {
  export interface CslItem extends Record<string, unknown> {
    id: string;
  }

  export class Cite {
    constructor(data: unknown);
    data: CslItem[];
  }

  interface CiteprocEngine {
    rebuildProcessorState(
      citations: unknown[],
      format: string,
      uncitedItemIds: string[],
    ): Array<[string, number, string]>;
    makeBibliography(): [
      { entry_ids: string[][]; bibliography_errors: unknown[] },
      string[],
    ] | false;
  }

  interface CslConfig {
    engine(
      data: CslItem[],
      style: string,
      locale: string,
      format: string,
    ): CiteprocEngine;
  }

  export const plugins: {
    config: {
      get(name: '@csl'): CslConfig;
    };
  };
}

declare module '@citation-js/plugin-bibtex';
declare module '@citation-js/plugin-csl';
