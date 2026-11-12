import { PDFDocument } from 'pdf-lib';
import { db } from '../storage/db';
import type { Page, StoredAsset } from '../storage/types';
import { loadPageContent, activePages } from '../storage/repo';
import { renderPage, canvasToPngBlob } from '../drawing/renderPage';
import { loadPdf, renderPdfPage } from '../pdf/loader';
import { downloadBlob, safeFilename } from '../lib/download';

const PDF_PX_TO_PT = 72 / 150;

async function assetBitmapsFor(pageId: string): Promise<Map<string, CanvasImageSource>> {
  const map = new Map<string, CanvasImageSource>();
  const images = await db.images.where('pageId').equals(pageId).toArray();
  for (const placement of images) {
    if (placement.deletedAt !== null || map.has(placement.assetId)) continue;
    const asset = await db.assets.get(placement.assetId);
    if (!asset) continue;
    try {
      map.set(placement.assetId, await createImageBitmap(asset.blob));
    } catch {
      // Skip unreadable images rather than failing the export.
    }
  }
  return map;
}

async function renderPdfAssetPage(page: Page, pixelRatio: number) {
  if (!page.pdfAssetId) return null;
  const asset = await db.assets.get(page.pdfAssetId);
  if (!asset) return null;
  const doc = await loadPdf(asset.blob);
  try {
    return await renderPdfPage(doc, page.pdfPageIndex, pixelRatio);
  } finally {
    await doc.destroy();
  }
}

export async function exportPagePng(page: Page, scale = 2): Promise<void> {
  const content = await loadPageContent(page.id);
  const bitmaps = await assetBitmapsFor(page.id);
  const pdf = page.pdfAssetId ? await renderPdfAssetPage(page, 1.5) : null;
  const rendered = renderPage({
    page,
    strokes: content.strokes,
    texts: content.texts,
    images: content.images,
    assetBitmaps: bitmaps,
    pdfCanvas: pdf?.canvas ?? null,
    scale,
    background: true,
    tint: page.backgroundTint,
    showBoundary: true,
  });
  const blob = await canvasToPngBlob(rendered.canvas);
  downloadBlob(blob, `${safeFilename(page.title || 'page')}.png`);
}

/**
 * Writes every page to a PDF. For annotated PDF pages the original page is
 * copied verbatim and the ink layer is drawn over it, so the source document
 * stays intact and searchable.
 */
export async function exportNotebookPdf(
  notebookId: string,
  notebookTitle: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const pages = await activePages(notebookId);
  if (pages.length === 0) return;
  const out = await PDFDocument.create();

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    onProgress?.(index, pages.length);
    const content = await loadPageContent(page.id);
    const bitmaps = await assetBitmapsFor(page.id);
    const pdfSource = page.pdfAssetId ? await db.assets.get(page.pdfAssetId) : null;

    if (pdfSource) {
      const ink = renderPage({
        page,
        strokes: content.strokes,
        texts: content.texts,
        images: content.images,
        assetBitmaps: bitmaps,
        pdfCanvas: null,
        scale: 2,
        background: false,
        tint: null,
        showBoundary: false,
      });
      const inkPng = await canvasToPngBlob(ink.canvas);
      const source = await PDFDocument.load(await pdfSource.blob.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const [copied] = await out.copyPages(source, [Math.min(page.pdfPageIndex, source.getPageCount() - 1)]);
      if (!copied) continue;
      out.addPage(copied);
      const { width, height } = copied.getSize();
      const image = await out.embedPng(await inkPng.arrayBuffer());
      copied.drawImage(image, { x: 0, y: 0, width, height });
    } else {
      const rendered = renderPage({
        page,
        strokes: content.strokes,
        texts: content.texts,
        images: content.images,
        assetBitmaps: bitmaps,
        pdfCanvas: null,
        scale: 2,
        background: true,
        tint: page.backgroundTint,
        showBoundary: true,
      });
      const png = await canvasToPngBlob(rendered.canvas);
      const image = await out.embedPng(await png.arrayBuffer());
      const pdfPage = out.addPage([page.width * PDF_PX_TO_PT, page.height * PDF_PX_TO_PT]);
      const { width, height } = pdfPage.getSize();
      pdfPage.drawImage(image, { x: 0, y: 0, width, height });
    }
  }
  onProgress?.(pages.length, pages.length);

  const bytes = await out.save();
  downloadBlob(new Blob([bytes.slice().buffer], { type: 'application/pdf' }), `${safeFilename(notebookTitle)}.pdf`);
}

export async function attachPdfAsPages(
  notebookId: string,
  file: File,
): Promise<{ pages: number; assetId: string }> {
  const { loadPdf, pdfPageSizes } = await import('../pdf/loader');
  const doc = await loadPdf(file);
  try {
    const sizes = await pdfPageSizes(doc);
    const asset = await savePdfAsset(file, doc.numPages);
    const { createPage } = await import('../storage/repo');
    const existing = await activePages(notebookId);
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i]!;
      const page = await createPage(notebookId, {
        template: 'blank',
        size: 'a4',
        index: existing.length + i,
        pdfAssetId: asset.id,
        pdfPageIndex: i,
        title: `${file.name.replace(/\.pdf$/i, '')} · ${i + 1}`,
      });
      // Page dimensions follow the source PDF geometry.
      await db.pages.put({ ...page, width: size.width, height: size.height });
    }
    return { pages: sizes.length, assetId: asset.id };
  } finally {
    await doc.destroy();
  }
}

async function savePdfAsset(file: File, pageCount: number): Promise<StoredAsset> {
  const { newId, now } = await import('../lib/id');
  const { saveAsset } = await import('../storage/assets');
  return saveAsset({
    kind: 'pdf',
    mime: 'application/pdf',
    name: file.name,
    blob: file,
    pageCount,
    id: newId(),
    createdAt: now(),
  });
}
