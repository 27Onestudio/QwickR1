const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_RANGE_CHARS = 128;
const MAX_RANGE_PAGES = 50_000;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type FileCheck = { error: string; pages: number | null };

export async function validateClientFile(file: File): Promise<FileCheck> {
  if (file.size > MAX_FILE_BYTES) return { error: "File exceeds 25 MB limit.", pages: null };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expectedMime = MIME_BY_EXTENSION[extension];
  if (!expectedMime || (file.type && file.type !== expectedMime && file.type !== "application/octet-stream")) {
    return { error: "Use a PDF, JPG, or PNG file.", pages: null };
  }

  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46 && header[4] === 0x2d;
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (!((extension === "pdf" && isPdf) || (extension === "png" && isPng) || ((extension === "jpg" || extension === "jpeg") && isJpeg))) {
    return { error: "File type could not be verified.", pages: null };
  }

  if (!isPdf) return { error: "", pages: 1 };
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    const pageCount = pdf.numPages;
    await task.destroy();
    return { error: "", pages: pageCount > 0 ? pageCount : null };
  } catch (cause) {
    const pdfError = cause as { name?: string; message?: string; code?: number };
    if (pdfError.name === "PasswordException" || /password|encrypted/i.test(pdfError.message ?? "")) {
      return { error: "Protected PDF. Please remove password before upload.", pages: null };
    }
    return { error: "", pages: null };
  }
}

export function countPagesInRange(range: string, totalPages: number | null): number | null {
  const cleaned = range.trim();
  if (!cleaned || cleaned.length > MAX_RANGE_CHARS) return null;
  const parts = cleaned.split(",").map(part => part.trim());
  if (parts.some(part => !/^\d+(?:-\d+)?$/.test(part))) return null;
  const selected = new Set<number>();
  for (const part of parts) {
    const [firstText, lastText] = part.split("-");
    const first = Number(firstText);
    const last = Number(lastText ?? firstText);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > MAX_RANGE_PAGES) return null;
    if (totalPages !== null && last > totalPages) return null;
    if (last - first + 1 > MAX_RANGE_PAGES) return null;
    for (let page = first; page <= last; page += 1) {
      selected.add(page);
      if (selected.size > MAX_RANGE_PAGES) return null;
    }
  }
  return selected.size || null;
}

export async function rotateFile(file: File, degrees: number): Promise<File> {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized === 0) return file;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") {
    const { PDFDocument, degrees: pdfDegrees } = await import("pdf-lib");
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    for (const page of pdf.getPages()) {
      page.setRotation(pdfDegrees((page.getRotation().angle + normalized) % 360));
    }
    const bytes = await pdf.save();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([buffer], file.name, { type: "application/pdf", lastModified: file.lastModified });
  }
  const isImage = file.type.startsWith("image/") || ["jpg", "jpeg", "png"].includes(extension);
  if (!isImage) return file;
  const outputType = file.type || MIME_BY_EXTENSION[extension] || "image/png";
  const bitmap = await createImageBitmap(file);
  const swapsSides = normalized === 90 || normalized === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapsSides ? bitmap.height : bitmap.width;
  canvas.height = swapsSides ? bitmap.width : bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image rotation is unavailable in this browser.");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalized * Math.PI) / 180);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error("Could not rotate this image.")), outputType);
  });
  return new File([blob], file.name, { type: outputType, lastModified: file.lastModified });
}
