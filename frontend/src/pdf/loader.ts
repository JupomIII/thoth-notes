import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

/** Loads a PDF from a Blob. Callers should keep the original bytes. */
export async function loadPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
}

export interface RenderedPdfPage {
  canvas: HTMLCanvasElement;
  /** PDF page size in points at 72 DPI. */
  widthPt: number;
  heightPt: number;
}

/** Renders one page at `pixelRatio` times its 72 DPI size. */
export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  pixelRatio: number,
): Promise<RenderedPdfPage> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const viewportScaled = page.getViewport({ scale: pixelRatio });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewportScaled.width));
  canvas.height = Math.max(1, Math.floor(viewportScaled.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: viewportScaled }).promise;
  page.cleanup();
  return { canvas, widthPt: viewport.width, heightPt: viewport.height };
}

/** Document-space size (150 DPI) of every page, used when importing. */
export async function pdfPageSizes(
  doc: PDFDocumentProxy,
): Promise<{ width: number; height: number }[]> {
  const sizes: { width: number; height: number }[] = [];
  const factor = 150 / 72;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: factor });
    sizes.push({ width: Math.round(viewport.width), height: Math.round(viewport.height) });
    page.cleanup();
  }
  return sizes;
}
