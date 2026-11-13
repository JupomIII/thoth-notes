/**
 * A compact LaTeX typesetter for canvas output.
 *
 * On screen equations are painted by KaTeX (crisp, accessible, selectable).
 * Thumbnails, PNG and PDF export need the formula inside a canvas, where DOM
 * markup cannot be used. Rather than screenshotting the DOM (fragile on
 * iPadOS), this module lays the formula out from KaTeX's parse tree and paints
 * it with real canvas text, so exports stay sharp at any resolution and need no
 * embedded web fonts.
 *
 * The layout covers the constructs the editor offers: fractions, roots,
 * scripts, big operators with limits, delimiters, matrices and cases, accents
 * and ordinary symbols. Anything unknown degrades to its flattened children.
 */

type Ctx = CanvasRenderingContext2D;

const MATH_FONT = '"Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman", serif';
const TEXT_FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

const BINARY = new Set([
  '+', '−', '-', '±', '∓', '×', '·', '∗', '÷', '∪', '∩', '∧', '∨', '∘', '⊗', '⊕',
]);
const RELATION = new Set([
  '=', '<', '>', '≤', '≥', '≠', '≈', '≡', '∼', '∝', '→', '←', '↔', '⇒', '⇐', '⇔', '∈', '∉', '⊂', '⊃', '⊆', '⊇', '∥', '⊥',
]);
const LARGE_OP = new Set([
  '∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⨁', '⨂', 'lim', 'max', 'min', 'sup', 'inf', 'argmax', 'argmin', 'det',
]);
const ITALIC_LETTER = /^[A-Za-z\u0391-\u03c9\u03d1\u03d5\u03d6]$/;

export interface MathLayout {
  /** Width in pixels at the requested size. */
  width: number;
  /** Height above the baseline. */
  height: number;
  /** Depth below the baseline. */
  depth: number;
  draw(ctx: Ctx, x: number, baseline: number): void;
}

interface Box extends MathLayout {
  /** Atom classification, used for spacing decisions. */
  kind?: 'ord' | 'bin' | 'rel' | 'punct' | 'op' | 'open' | 'close' | 'inner';
  opText?: string;
}

function empty(): Box {
  return { width: 0, height: 0, depth: 0, draw: () => undefined, kind: 'ord' };
}

function setFont(ctx: Ctx, size: number, italic: boolean, text = false): void {
  ctx.font = `${italic ? 'italic ' : ''}${size}px ${text ? TEXT_FONT : MATH_FONT}`;
}

function spacingWidth(name: string, size: number): number {
  const em = size;
  switch (name) {
    case '\\,':
    case '\\thinspace':
      return em * 0.166;
    case '\\:':
    case '\\>':
    case '\\medspace':
      return em * 0.222;
    case '\\;':
    case '\\thickspace':
      return em * 0.277;
    case '\\!':
      return -em * 0.166;
    case '\\quad':
      return em;
    case '\\qquad':
      return em * 2;
    case '~':
    case '\\ ':
    case '\\space':
      return em * 0.25;
    default:
      return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Node helpers                                                        */
/* ------------------------------------------------------------------ */

type AnyNode = { type?: string; [key: string]: unknown };

function asArray(value: unknown): AnyNode[] {
  if (Array.isArray(value)) return value as AnyNode[];
  if (value && typeof value === 'object') {
    const node = value as AnyNode;
    if (node.type === 'ordgroup' && Array.isArray(node.body)) return node.body as AnyNode[];
    return [node];
  }
  return [];
}

function nodeText(node: AnyNode | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.body)) return (node.body as AnyNode[]).map(nodeText).join('');
  return '';
}

function classify(text: string): NonNullable<Box['kind']> {
  if (BINARY.has(text)) return 'bin';
  if (RELATION.has(text)) return 'rel';
  if (text === ',' || text === ';') return 'punct';
  if (text === '(' || text === '[' || text === '\\{') return 'open';
  if (text === ')' || text === ']' || text === '\\}') return 'close';
  return 'ord';
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

interface LayoutContext {
  canvas: CanvasRenderingContext2D;
  color: string;
}

function layoutNode(list: AnyNode[], size: number, env: LayoutContext): Box {
  const parts: Box[] = [];
  for (const node of list) {
    const box = layoutSingle(node, size, env);
    if (box.width !== 0 || box.height !== 0 || box.depth !== 0) parts.push(box);
  }
  return rowBox(parts, size, env);
}

function rowBox(parts: Box[], size: number, env: LayoutContext): Box {
  const ctx = env.canvas;
  const compact: Box[] = [];
  const space = ctx.measureText(' ').width;
  parts.forEach((part, index) => {
    if (index > 0) {
      const prev = parts[index - 1]!;
      const tight =
        (prev.kind === 'op' && part.kind !== 'bin') ||
        (part.kind === 'close') ||
        (prev.kind === 'open');
      if (prev.kind && part.kind && !tight && (part.kind !== 'ord' || prev.kind === 'bin' || prev.kind === 'rel')) {
        compact.push({
          width: size * (prev.kind === 'rel' || part.kind === 'rel' ? 0.277 : 0.222),
          height: 0,
          depth: 0,
          draw: () => undefined,
        });
      } else if (prev.kind === 'punct' && part.kind !== 'ord') {
        compact.push({ width: size * 0.166, height: 0, depth: 0, draw: () => undefined });
      }
    }
    compact.push(part);
  });
  void space;

  let width = 0;
  let height = 0;
  let depth = 0;
  for (const part of compact) {
    width += part.width;
    height = Math.max(height, part.height);
    depth = Math.max(depth, part.depth);
  }
  if (compact.length === 0) return empty();
  return {
    width,
    height,
    depth,
    draw(ctx, x, baseline) {
      let cursor = x;
      for (const part of compact) {
        part.draw(ctx, cursor, baseline);
        cursor += part.width;
      }
    },
  };
}

function textBox(
  text: string,
  size: number,
  env: LayoutContext,
  options: { text?: boolean; italic?: boolean; kind?: Box['kind'] } = {},
): Box {
  const ctx = env.canvas;
  const italic = options.italic ?? false;
  setFont(ctx, size, italic, options.text);
  const metrics = ctx.measureText(text);
  const width = metrics.width;
  const height = metrics.actualBoundingBoxAscent || size * 0.72;
  const depth = metrics.actualBoundingBoxDescent || 0;
  return {
    width,
    height,
    depth,
    kind: options.kind ?? classify(text),
    opText: text,
    draw(ctx2, x, baseline) {
      ctx2.save();
      ctx2.fillStyle = env.color;
      ctx2.textBaseline = 'alphabetic';
      setFont(ctx2, size, italic, options.text);
      ctx2.fillText(text, x, baseline);
      ctx2.restore();
    },
  };
}

function symbolBox(text: string, size: number, env: LayoutContext): Box {
  const italic = ITALIC_LETTER.test(text);
  return textBox(text, size, env, { italic, kind: classify(text) });
}

function layoutSingle(node: AnyNode, size: number, env: LayoutContext): Box {
  const type = String(node.type ?? '');
  switch (type) {
    case 'ordgroup':
    case 'styling':
    case 'color':
    case 'infix':
    case 'operatorname':
    case 'font':
      return layoutNode(asArray(node.body), size, env);
    case 'text':
      return layoutNode(asArray(node.body), size, env);
    case 'mathord':
    case 'textord':
    case 'atom':
    case 'op':
      return symbolBox(nodeText(node), size, env);
    case 'spacing':
      return { width: spacingWidth(nodeText(node), size), height: 0, depth: 0, draw: () => undefined };
    case 'mspace':
    case 'kern': {
      const em = typeof node.width === 'number' ? (node.width as number) : 0.166;
      return { width: em * size, height: 0, depth: 0, draw: () => undefined };
    }
    case 'rule': {
      const height = typeof node.height === 'number' ? (node.height as number) : 0.04;
      const width = typeof node.width === 'number' ? (node.width as number) : 0.4;
      return {
        width: width * size,
        height: height * size,
        depth: 0,
        draw(ctx, x, baseline) {
          ctx.save();
          ctx.fillStyle = env.color;
          ctx.fillRect(x, baseline - height * size, width * size, Math.max(1, height * size));
          ctx.restore();
        },
      };
    }
    case 'supsub':
      return layoutScripts(node, size, env);
    case 'genfrac':
    case 'frac':
      return layoutFraction(node, size, env);
    case 'sqrt':
      return layoutRoot(node, size, env);
    case 'leftright':
      return layoutDelimited(node, size, env);
    case 'array':
      return layoutArray(node, size, env);
    case 'accent':
      return layoutAccent(node, size, env);
    case 'overline':
    case 'underline': {
      const body = layoutNode(asArray(node.body), size, env);
      const thickness = Math.max(1, size * 0.05);
      const offset = size * 0.16;
      return {
        width: body.width,
        height: body.height + (type === 'overline' ? offset + thickness : 0),
        depth: body.depth + (type === 'underline' ? offset + thickness : 0),
        draw(ctx, x, baseline) {
          body.draw(ctx, x, baseline);
          ctx.save();
          ctx.fillStyle = env.color;
          if (type === 'overline') {
            ctx.fillRect(x, baseline - body.height - offset - thickness, body.width, thickness);
          } else {
            ctx.fillRect(x, baseline + body.depth + offset, body.width, thickness);
          }
          ctx.restore();
        },
      };
    }
    case 'delimsizing': {
      const delim = nodeText(node);
      const height = size * 1.2;
      const box = textBox(delim, height, env, { kind: delim === '(' ? 'open' : 'close' });
      return box;
    }
    case 'horizBrace':
    case 'enclose':
    case 'raisebox':
    case 'vphantom':
    case 'phantom':
    case 'smash':
    case 'lap':
    case 'sizing':
    case 'fontsize':
      return layoutNode(asArray(node.body), size, env);
    default: {
      if (typeof node.text === 'string') return symbolBox(node.text as string, size, env);
      if (Array.isArray(node.body)) return layoutNode(node.body as AnyNode[], size, env);
      return empty();
    }
  }
}

function layoutScripts(node: AnyNode, size: number, env: LayoutContext): Box {
  const base = layoutNode(asArray(node.base), size, env);
  const baseText = nodeText(asArray(node.base)[0]);
  const scriptSize = size * 0.7;
  const supNode = node.sup ? layoutNode(asArray(node.sup), scriptSize, env) : null;
  const subNode = node.sub ? layoutNode(asArray(node.sub), scriptSize, env) : null;
  const limits = LARGE_OP.has(baseText) || baseText === 'lim';

  if (limits && (supNode || subNode)) {
    const width = Math.max(base.width, supNode?.width ?? 0, subNode?.width ?? 0);
    const gap = size * 0.12;
    const height = base.height + (supNode ? supNode.height + supNode.depth + gap : 0);
    const depth = base.depth + (subNode ? subNode.height + subNode.depth + gap : 0);
    return {
      width,
      height,
      depth,
      kind: 'op',
      draw(ctx, x, baseline) {
        base.draw(ctx, x + (width - base.width) / 2, baseline);
        if (supNode) {
          supNode.draw(ctx, x + (width - supNode.width) / 2, baseline - base.height - gap - supNode.depth);
        }
        if (subNode) {
          subNode.draw(ctx, x + (width - subNode.width) / 2, baseline + base.depth + gap + subNode.height);
        }
      },
    };
  }

  const shiftUp = Math.max(base.height * 0.62, scriptSize * 0.62);
  const shiftDown = Math.max(base.depth + scriptSize * 0.28, scriptSize * 0.18);
  const supPad = supNode ? size * 0.04 : 0;
  const width = base.width + Math.max(supNode?.width ?? 0, subNode?.width ?? 0) + supPad;
  const height = Math.max(base.height, supNode ? shiftUp + supNode.height : 0);
  const depth = Math.max(base.depth, subNode ? shiftDown + subNode.depth : 0);
  return {
    width,
    height,
    depth,
    kind: 'ord',
    draw(ctx, x, baseline) {
      base.draw(ctx, x, baseline);
      const scriptX = x + base.width + supPad;
      if (supNode) supNode.draw(ctx, scriptX, baseline - shiftUp);
      if (subNode) subNode.draw(ctx, scriptX, baseline + shiftDown);
    },
  };
}

function layoutFraction(node: AnyNode, size: number, env: LayoutContext): Box {
  const inner = Math.max(0.75, size);
  const numer = layoutNode(asArray(node.numer), inner, env);
  const denom = layoutNode(asArray(node.denom), inner, env);
  const axis = inner * 0.26;
  const clearance = inner * 0.12;
  const padding = inner * 0.12;
  const width = Math.max(numer.width, denom.width) + padding * 2;
  const height = axis + clearance + numer.height + numer.depth;
  const depth = -axis + clearance + denom.height + denom.depth;
  const hasBar = node.hasBarLine !== false;
  const barThickness = Math.max(1, inner * 0.045);
  return {
    width,
    height,
    depth,
    kind: 'inner',
    draw(ctx, x, baseline) {
      numer.draw(ctx, x + (width - numer.width) / 2, baseline - axis - clearance - numer.depth);
      denom.draw(ctx, x + (width - denom.width) / 2, baseline - axis + clearance + denom.height);
      if (hasBar) {
        ctx.save();
        ctx.fillStyle = env.color;
        ctx.fillRect(x + padding * 0.35, baseline - axis - barThickness / 2, width - padding * 0.7, barThickness);
        ctx.restore();
      }
      void height;
      void depth;
    },
  };
}

function layoutRoot(node: AnyNode, size: number, env: LayoutContext): Box {
  const body = layoutNode(asArray(node.body), size, env);
  const index = node.index ? layoutNode(asArray(node.index), size * 0.62, env) : null;
  const thickness = Math.max(1, size * 0.045);
  const gap = size * 0.14;
  const radicalWidth = size * 0.52;
  const width = body.width + gap + radicalWidth + (index ? index.width * 0.35 : 0);
  const height = body.height + gap + thickness;
  const depth = body.depth;
  return {
    width,
    height,
    depth,
    kind: 'ord',
    draw(ctx, x, baseline) {
      const bodyX = x + radicalWidth + gap;
      body.draw(ctx, bodyX, baseline);
      const top = baseline - body.height - gap - thickness;
      ctx.save();
      ctx.fillStyle = env.color;
      ctx.strokeStyle = env.color;
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + radicalWidth * 0.05, baseline - body.height * 0.42);
      ctx.lineTo(x + radicalWidth * 0.34, baseline - body.height * 0.5);
      ctx.lineTo(x + radicalWidth * 0.58, baseline);
      ctx.lineTo(x + radicalWidth * 0.78, top);
      ctx.lineTo(bodyX + body.width, top);
      ctx.stroke();
      ctx.fillRect(bodyX, top - thickness / 2, body.width, thickness);
      ctx.restore();
      if (index) index.draw(ctx, x, baseline - height + index.depth * 0.5);
    },
  };
}

function delimiterBox(delim: string, size: number, targetHeight: number, side: 'open' | 'close', env: LayoutContext): Box {
  const glyph = delim || '';
  if (!glyph || glyph === '.') return { width: 0, height: 0, depth: 0, draw: () => undefined, kind: side };
  const base = textBox(glyph, size * 1.15, env, { kind: side });
  const naturalHeight = base.height + base.depth;
  const stretch = Math.max(1, targetHeight / Math.max(1, naturalHeight * 0.9));
  if (stretch <= 1.02) return { ...base, kind: side };
  return {
    width: base.width * Math.min(stretch, 2.2),
    height: base.height * stretch * 0.85,
    depth: base.depth * stretch * 0.85,
    kind: side,
    draw(ctx, x, baseline) {
      ctx.save();
      ctx.translate(x + (base.width * stretch) / 2, baseline);
      ctx.scale(1, stretch * 0.9);
      base.draw(ctx, -base.width / 2, 0);
      ctx.restore();
    },
  };
}

function layoutDelimited(node: AnyNode, size: number, env: LayoutContext): Box {
  const body = layoutNode(asArray(node.body), size, env);
  const target = body.height + body.depth + size * 0.2;
  const left = delimiterBox(nodeText({ text: node.left as string }), size, target, 'open', env);
  const right = delimiterBox(nodeText({ text: node.right as string }), size, target, 'close', env);
  const width = left.width + body.width + right.width;
  return {
    width,
    height: Math.max(body.height, left.height, right.height),
    depth: Math.max(body.depth, left.depth, right.depth),
    kind: 'inner',
    draw(ctx, x, baseline) {
      left.draw(ctx, x, baseline);
      body.draw(ctx, x + left.width, baseline);
      right.draw(ctx, x + left.width + body.width, baseline);
    },
  };
}

function layoutArray(node: AnyNode, size: number, env: LayoutContext): Box {
  const rows = (node.body as AnyNode[][]) ?? [];
  const cellSize = size * 0.92;
  const columnGap = size * 0.5;
  const rowGap = size * 0.24;
  const laidOut: Box[][] = rows.map((row) => row.map((cell) => layoutNode(asArray(cell), cellSize, env)));
  const columns = laidOut.reduce((max, row) => Math.max(max, row.length), 0);
  const colWidths: number[] = [];
  for (let c = 0; c < columns; c++) {
    colWidths[c] = Math.max(...laidOut.map((row) => row[c]?.width ?? 0), 0);
  }
  const rowHeights = laidOut.map((row) => Math.max(...row.map((cell) => cell.height), cellSize * 0.6));
  const rowDepths = laidOut.map((row) => Math.max(...row.map((cell) => cell.depth), 0));
  const width = colWidths.reduce((sum, w) => sum + w, 0) + columnGap * Math.max(0, columns - 1);
  const totalRows = rowHeights.reduce((sum, h, i) => sum + h + rowDepths[i]! + rowGap, 0) - rowGap;
  const axis = size * 0.26;
  const height = totalRows / 2 + axis;
  const depth = totalRows / 2 - axis;
  return {
    width,
    height,
    depth,
    kind: 'inner',
    draw(ctx, x, baseline) {
      let top = baseline - height;
      laidOut.forEach((row, r) => {
        const rowHeight = rowHeights[r]!;
        const rowBaseline = top + rowHeight;
        let cursor = x;
        row.forEach((cell, c) => {
          const colWidth = colWidths[c]!;
          const aligned = node.align === 'left' ? 0 : (colWidth - cell.width) / 2;
          cell.draw(ctx, cursor + aligned, rowBaseline);
          cursor += colWidth + columnGap;
        });
        top += rowHeight + rowDepths[r]! + rowGap;
      });
    },
  };
}

function layoutAccent(node: AnyNode, size: number, env: LayoutContext): Box {
  const body = layoutNode(asArray(node.body), size, env);
  const label = String(node.label ?? '');
  const mark =
    label === '\\hat' || label === '^'
      ? '\u02c6'
      : label === '\\bar' || label === '\\overline'
        ? '\u00af'
        : label === '\\vec'
          ? '\u20d7'
          : label === '\\tilde'
            ? '\u02dc'
            : label === '\\dot'
              ? '\u02d9'
              : '\u00af';
  const accentSize = size * 0.9;
  const accent = textBox(mark, accentSize, env);
  return {
    width: body.width,
    height: Math.max(body.height, accent.height * 0.55) + accentSize * 0.1,
    depth: body.depth,
    draw(ctx, x, baseline) {
      body.draw(ctx, x, baseline);
      accent.draw(ctx, x + Math.max(0, (body.width - accent.width) / 2), baseline - body.height - accentSize * 0.12);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const cache = new Map<string, MathLayout>();

type KatexParser = { __parse?: (input: string, options?: unknown) => AnyNode[] };

let parser: KatexParser | null = null;
let parserPromise: Promise<void> | null = null;

/** Loads KaTeX's parser only when a formula must be painted into a canvas. */
export function loadTypesetter(): Promise<void> {
  if (parser) return Promise.resolve();
  if (!parserPromise) {
    parserPromise = import('katex').then((module) => {
      const candidate = (module as unknown as { default?: KatexParser }).default ?? (module as unknown as KatexParser);
      parser = candidate;
    });
  }
  return parserPromise;
}

function parseLatex(latex: string): AnyNode[] | null {
  if (!parser) {
    void loadTypesetter();
    return null;
  }
  if (typeof parser.__parse !== 'function') return null;
  try {
    return parser.__parse(latex, { displayMode: true });
  } catch {
    return null;
  }
}

function plainFallback(latex: string, size: number, env: LayoutContext): MathLayout {
  const cleaned = latex
    .replace(/\\[a-zA-Z]+/g, (match) => match.replace('\\', ''))
    .replace(/[{}$]/g, '')
    .trim();
  return textBox(cleaned || latex, size, env, { text: true });
}

/**
 * Lays a formula out at `size` document pixels. The result is measured in the
 * same units and can be drawn onto any 2D context.
 */
export function typesetMath(latex: string, size: number, color: string): MathLayout {
  const key = `${size}|${color}|${latex}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback: MathLayout = {
      width: latex.length * size * 0.5,
      height: size * 0.7,
      depth: size * 0.2,
      draw: () => undefined,
    };
    return fallback;
  }
  const env: LayoutContext = { canvas: ctx, color };
  const tree = parseLatex(latex);
  const layout = tree ? layoutNode(tree, size, env) : plainFallback(latex, size, env);
  const result: MathLayout = {
    width: Math.max(1, layout.width),
    height: Math.max(size * 0.5, layout.height),
    depth: Math.max(0, layout.depth),
    draw: layout.draw,
  };
  if (cache.size > 320) cache.clear();
  cache.set(key, result);
  return result;
}

/** Measures only, for layout code that runs before any canvas paint. */
export function measureMath(latex: string, size: number, color = '#1f1d1a'): { width: number; height: number; depth: number } {
  const layout = typesetMath(latex, size, color);
  return { width: layout.width, height: layout.height, depth: layout.depth };
}

/** Draws a formula with its box's top-left corner at (x, top). */
export function drawTypeset(
  ctx: Ctx,
  latex: string,
  x: number,
  top: number,
  size: number,
  color: string,
  maxWidth?: number,
): { width: number; height: number } {
  const layout = typesetMath(latex, size, color);
  ctx.save();
  if (maxWidth && layout.width > maxWidth) {
    const factor = maxWidth / layout.width;
    ctx.translate(x, top + layout.height * factor);
    ctx.scale(factor, factor);
    layout.draw(ctx, 0, 0);
    ctx.restore();
    return { width: maxWidth, height: (layout.height + layout.depth) * factor };
  }
  layout.draw(ctx, x, top + layout.height);
  ctx.restore();
  return { width: layout.width, height: layout.height + layout.depth };
}

export function equationHeight(latex: string, size: number, color = '#1f1d1a'): number {
  const layout = typesetMath(latex, size, color);
  return layout.height + layout.depth;
}
