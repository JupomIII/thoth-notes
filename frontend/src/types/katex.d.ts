/**
 * Minimal declarations for KaTeX. The package ships an untyped ESM bundle for
 * bundlers, so the small surface this app uses is declared here instead of
 * pulling in a separate type package.
 */
declare module 'katex' {
  export interface KatexOptions {
    displayMode?: boolean;
    throwOnError?: boolean;
    errorColor?: string;
    strict?: boolean | 'ignore' | 'warn' | 'error';
    trust?: boolean;
    output?: 'html' | 'mathml' | 'htmlAndMathml';
    macros?: Record<string, string>;
  }

  export function renderToString(latex: string, options?: KatexOptions): string;
  export function render(latex: string, element: HTMLElement, options?: KatexOptions): void;

  const katex: {
    renderToString: typeof renderToString;
    render: typeof render;
    __parse?: (input: string, options?: unknown) => unknown;
  };

  export default katex;
}
