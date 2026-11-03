import * as pdfjs from "pdfjs-dist";

let workerSet = false;

async function ensureWorker() {
  if (workerSet) return;
  try {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  } catch {
    const { pathToFileURL } = await import("node:url");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs")).href;
  }
  workerSet = true;
}

type Glyph = { str: string; x: number; y: number; width: number };

/** Pull the text layer out of a DRYAD PDF, one visual line at a time. */
export async function textFromPdf(data: ArrayBuffer): Promise<string> {
  await ensureWorker();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const glyphs: Glyph[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      glyphs.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
    }
    glyphs.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Glyph[][] = [];
    for (const glyph of glyphs) {
      const line = lines.find((row) => Math.abs(row[0].y - glyph.y) < 2);
      if (line) line.push(glyph);
      else lines.push([glyph]);
    }
    pages.push(lines.map((line) => {
      line.sort((a, b) => a.x - b.x);
      let text = "";
      let end = -1;
      for (const glyph of line) {
        if (end >= 0 && glyph.x - end > 1.5) text += " ";
        text += glyph.str;
        end = glyph.x + glyph.width;
      }
      return text;
    }).join("\n"));
  }
  return pages.join("\n");
}

/** Read one DRYAD file. PDF uses the text layer. Anything else is plain text. */
export async function textFromDryadFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return textFromPdf(await file.arrayBuffer());
  return file.text();
}
