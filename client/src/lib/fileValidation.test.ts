import { describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.reject(Object.assign(new Error("Password required"), { name: "PasswordException" })),
    destroy: async () => undefined,
  }),
}));

import { countPagesInRange, rotateFile, validateClientFile } from "./fileValidation";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("countPagesInRange", () => {
  it("counts a single page and a simple range", () => {
    expect(countPagesInRange("2", 8)).toBe(1);
    expect(countPagesInRange("1-4", 8)).toBe(4);
  });

  it("counts comma-separated ranges without double-counting", () => {
    expect(countPagesInRange("1,3-4,4", 8)).toBe(3);
  });

  it("allows a well-formed range when total page count is unavailable", () => {
    expect(countPagesInRange("1-4", null)).toBe(4);
  });

  it.each(["", "0", "4-2", "1--4", "1-x", "1-9"])("rejects invalid range %s", range => {
    expect(countPagesInRange(range, 8)).toBeNull();
  });

  it("rejects oversized ranges and excessive input before enumerating pages", () => {
    expect(countPagesInRange("1-50001", null)).toBeNull();
    expect(countPagesInRange("1".repeat(129), null)).toBeNull();
  });
});

describe("validateClientFile", () => {
  it("blocks files larger than 25 MB before reading their contents", async () => {
    const file = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "large.png", { type: "image/png" });
    await expect(validateClientFile(file)).resolves.toMatchObject({ error: "File exceeds 25 MB limit.", pages: null });
  });

  it("rejects unsupported extensions and incorrect signatures", async () => {
    const unsupported = new File(["text"], "notes.txt", { type: "text/plain" });
    const wrongSignature = new File(["not a png"], "wrong.png", { type: "image/png" });
    await expect(validateClientFile(unsupported)).resolves.toMatchObject({ error: "Use a PDF, JPG, or PNG file." });
    await expect(validateClientFile(wrongSignature)).resolves.toMatchObject({ error: "File type could not be verified." });
  });

  it("accepts a correctly signed PNG as an image", async () => {
    const file = new File([pngBytes], "image.png", { type: "image/png" });
    await expect(validateClientFile(file)).resolves.toEqual({ error: "", pages: 1 });
  });

  it("shows the requested message for a password-protected PDF", async () => {
    const header = new TextEncoder().encode("%PDF-1.7\n");
    const file = new File([header], "locked.pdf", { type: "application/pdf" });
    await expect(validateClientFile(file)).resolves.toMatchObject({ error: "Protected PDF. Please remove password before upload.", pages: null });
  });
});

describe("rotateFile", () => {
  it("changes page rotation inside a PDF instead of only storing rotation metadata", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.create();
    source.addPage([100, 200]);
    const saved = await source.save();
    const pdfBuffer = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
    const input = new File([pdfBuffer], "page.pdf", { type: "application/pdf" });
    const rotated = await rotateFile(input, 90);
    const result = await PDFDocument.load(await rotated.arrayBuffer());
    expect(result.getPages()[0].getRotation().angle).toBe(90);
  });
});
