import type { PaperTemplate } from '../storage/types';

export interface PaperOptions {
  template: PaperTemplate;
  /** Document width/height; 0 for infinite boards. */
  width: number;
  height: number;
  /** Current view scale, used to keep hairlines visually constant. */
  scale: number;
  tint: string | null;
  infinite: boolean;
  showBoundary: boolean;
}

const PAPER_FILL = '#fffdf9';
const RULE = '#dcd7cc';
const RULE_STRONG = '#c9c2b3';
const MARGIN = '#d9b9ad';

function hairline(scale: number): number {
  return Math.max(0.4, 1 / Math.max(1, scale));
}

/**
 * Paints the paper backdrop. Grid/lines are generated procedurally so the
 * background stays crisp at any zoom and never consumes storage.
 */
export function drawPaper(ctx: CanvasRenderingContext2D, opts: PaperOptions): void {
  const { template, width, height, scale, tint, infinite, showBoundary } = opts;
  ctx.save();
  ctx.lineCap = 'butt';

  if (infinite) {
    ctx.fillStyle = tint ?? '#fbf9f5';
    ctx.fillRect(-100000, -100000, 200000, 200000);
    ctx.restore();
    drawInfiniteDots(ctx, scale, scale);
    return;
  }

  // Drop shadow around the sheet, drawn in document units.
  ctx.save();
  ctx.shadowColor = 'rgba(31, 29, 26, 0.12)';
  ctx.shadowBlur = 24 / scale;
  ctx.shadowOffsetY = 6 / scale;
  ctx.fillStyle = tint ?? PAPER_FILL;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.fillStyle = tint ?? PAPER_FILL;
  ctx.fillRect(0, 0, width, height);

  const lineWidth = hairline(scale);
  ctx.lineWidth = lineWidth;

  switch (template) {
    case 'blank':
      break;
    case 'ruled': {
      const gap = 42;
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      for (let y = gap; y < height; y += gap) {
        ctx.moveTo(48, y + 0.5);
        ctx.lineTo(width - 48, y + 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = MARGIN;
      ctx.beginPath();
      ctx.moveTo(108, 0);
      ctx.lineTo(108, height);
      ctx.stroke();
      break;
    }
    case 'grid': {
      const gap = 36;
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      for (let x = gap; x < width; x += gap) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = gap; y < height; y += gap) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();
      break;
    }
    case 'dots': {
      const gap = 36;
      ctx.fillStyle = RULE_STRONG;
      for (let x = gap; x < width; x += gap) {
        for (let y = gap; y < height; y += gap) {
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1, 1.5 / Math.max(1, scale * 0.6)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'graph': {
      const small = 18;
      const large = 90;
      ctx.strokeStyle = '#e7e2d8';
      ctx.beginPath();
      for (let x = small; x < width; x += small) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = small; y < height; y += small) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = '#c9c2b3';
      ctx.beginPath();
      for (let x = large; x < width; x += large) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = large; y < height; y += large) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();
      break;
    }
    case 'isometric': {
      const step = 34;
      ctx.strokeStyle = '#e2dcd0';
      ctx.beginPath();
      const diagonal = Math.ceil((width + height) / step);
      for (let i = -diagonal; i < diagonal; i++) {
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step + height * 0.577, height);
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step - height * 0.577, height);
      }
      ctx.stroke();
      break;
    }
    default:
      break;
  }

  if (showBoundary) {
    ctx.strokeStyle = 'rgba(31, 29, 26, 0.12)';
    ctx.lineWidth = hairline(scale) * 1.5;
    ctx.strokeRect(0, 0, width, height);
  }
  ctx.restore();
}

function drawInfiniteDots(ctx: CanvasRenderingContext2D, spacing: number, scale: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(160, 152, 138, 0.35)';
  const gap = 80 * spacing;
  const r = Math.max(0.8, 1.2 / Math.max(1, scale));
  const startX = Math.floor(-4000 / gap) * gap;
  const startY = Math.floor(-4000 / gap) * gap;
  for (let x = startX; x < 4000; x += gap) {
    for (let y = startY; y < 4000; y += gap) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
