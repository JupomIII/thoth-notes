import type { TextBlock } from '../storage/types';

export const TEXT_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (ctx.measureText(candidate).width > width && line.trim().length > 0) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function paintText(ctx: CanvasRenderingContext2D, text: TextBlock): void {
  ctx.save();
  ctx.fillStyle = text.color;
  ctx.font = `${text.fontSize}px ${TEXT_FONT_STACK}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = text.align === 'center' ? 'center' : text.align === 'right' ? 'right' : 'left';
  const anchorX =
    text.align === 'center' ? text.x + text.width / 2 : text.align === 'right' ? text.x + text.width : text.x;
  const lines = wrapText(ctx, text.text, text.width);
  let y = text.y;
  for (const line of lines) {
    ctx.fillText(line, anchorX, y);
    y += text.fontSize * 1.35;
  }
  ctx.restore();
}

export function textBlockHeight(ctx: CanvasRenderingContext2D, text: TextBlock): number {
  ctx.save();
  ctx.font = `${text.fontSize}px ${TEXT_FONT_STACK}`;
  const lines = wrapText(ctx, text.text, text.width);
  ctx.restore();
  return Math.max(text.fontSize * 1.4, lines.length * text.fontSize * 1.35);
}
