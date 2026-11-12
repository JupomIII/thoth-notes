import type { ImagePlacement, Page, Stroke, TextBlock } from '../storage/types';
import { drawPaper } from './paper';
import { drawStroke } from './strokeRender';
import { paintText } from './textRender';
import { boundsOfPoints } from '../lib/geometry';

export interface RenderPageInput {
  page: Page;
  strokes: Stroke[];
  texts: TextBlock[];
  images: ImagePlacement[];
  assetBitmaps: Map<string, CanvasImageSource>;
  pdfCanvas: CanvasImageSource | null;
  /** Output pixels per document pixel. */
  scale: number;
  background: boolean;
  tint: string | null;
  showBoundary: boolean;
}

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Document-space origin of the rendered canvas (non-zero for infinite pages). */
  originX: number;
  originY: number;
}

function contentBounds(input: RenderPageInput): { x: number; y: number; width: number; height: number } {
  const points: { x: number; y: number }[] = [];
  for (const stroke of input.strokes) points.push(...stroke.points);
  for (const text of input.texts) {
    points.push({ x: text.x, y: text.y }, { x: text.x + text.width, y: text.y + text.fontSize * 2 });
  }
  for (const image of input.images) {
    points.push({ x: image.x, y: image.y }, { x: image.x + image.width, y: image.y + image.height });
  }
  if (points.length === 0) return { x: 0, y: 0, width: 1240, height: 1754 };
  const bounds = boundsOfPoints(points, 48);
  return {
    x: Math.max(0, bounds.minX),
    y: Math.max(0, bounds.minY),
    width: Math.max(200, bounds.maxX - bounds.minX),
    height: Math.max(200, bounds.maxY - bounds.minY),
  };
}

/** Renders a page off-screen for PNG/PDF export and thumbnails. */
export function renderPage(input: RenderPageInput): RenderedPage {
  const infinite = input.page.size === 'infinite';
  const bounds = infinite
    ? contentBounds(input)
    : { x: 0, y: 0, width: input.page.width, height: input.page.height };

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bounds.width * input.scale));
  canvas.height = Math.max(1, Math.round(bounds.height * input.scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  ctx.setTransform(input.scale, 0, 0, input.scale, 0, 0);
  ctx.translate(-bounds.x, -bounds.y);

  if (input.background) {
    drawPaper(ctx, {
      template: input.page.template,
      width: bounds.width,
      height: bounds.height,
      scale: input.scale,
      tint: input.tint,
      infinite: false,
      showBoundary: input.showBoundary && !infinite,
    });
    if (input.pdfCanvas) {
      ctx.drawImage(input.pdfCanvas, bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  for (const stroke of input.strokes) drawStroke(ctx, stroke);
  for (const image of input.images) {
    const bitmap = input.assetBitmaps.get(image.assetId);
    if (bitmap) ctx.drawImage(bitmap, image.x, image.y, image.width, image.height);
  }
  for (const text of input.texts) paintText(ctx, text);

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    originX: bounds.x,
    originY: bounds.y,
  };
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encoding failed'));
    }, 'image/png');
  });
}
