import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import multer from "multer";
import path from "path";
import { randomBytes, randomInt } from "crypto";
import { fileURLToPath } from "url";
import { buildDemoUpiUri, quoteDemoJob, type DemoQuote } from "./demoPayment";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const SESSION_MS = 10 * 60 * 1000;
const RENEWAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_RENEWALS_PER_WINDOW = 3;
const MAX_PAGE_RANGE_CHARS = 128;
const MAX_PAGE_RANGE_PAGES = 50_000;
const MAX_STORED_BYTES = 512 * 1024 * 1024;
const MAX_ACTIVE_SESSIONS = 100;
const MAX_IN_FLIGHT_UPLOADS = 2;
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 8, fieldSize: 32 * 1024, parts: MAX_FILES + 8 },
});

type StoredFile = { id: string; name: string; type: string; size: number; bytes: Buffer; pages: number | null };
type SessionBase = { code: string; files: StoredFile[]; expiresAt: number; createdAt: number; clientSessionId: string };
type PaymentMethod = "upi" | "offline";
type PaymentStatus = "unselected" | "pending" | "paid";
type JobPayment = { method: PaymentMethod | null; status: PaymentStatus; amount: number | null; upiUri: string | null; confirmedAt: number | null };
type PrintJob = SessionBase & { ownerToken: string; renewals: number[]; metadata: Record<string, unknown>; payment: JobPayment };
type ShareJob = SessionBase & { ownerToken: string; renewals: number[] };
const jobs = new Map<string, PrintJob>();
const shareJobs = new Map<string, ShareJob>();
const jobByClientId = new Map<string, string>();
const shareByClientId = new Map<string, string>();
const lookupAttempts = new Map<string, { startedAt: number; count: number }>();
const uploadAttempts = new Map<string, { startedAt: number; count: number }>();
let inFlightUploads = 0;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function generateCode() {
  let value = "";
  for (let i = 0; i < 6; i += 1) value += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return value;
}
function uniqueCode() {
  let value = generateCode();
  while (jobs.has(value) || shareJobs.has(value)) value = generateCode();
  return value;
}
function validCode(value: string) { return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(value); }
function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { throw new HttpError(400, "Print settings could not be read."); }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  throw new HttpError(400, "Print settings could not be read.");
}
function normalizeRotation(value: unknown) {
  const angle = Number(value);
  return [0, 90, 180, 270].includes(angle) ? angle : 0;
}
function validatePageRange(range: unknown, totalPages: number | null) {
  if (typeof range !== "string" || !range.trim() || range.length > MAX_PAGE_RANGE_CHARS) throw new HttpError(400, "Enter a valid page range.");
  const parts = range.trim().split(",").map(part => part.trim());
  let selectedPages = 0;
  for (const part of parts) {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw new HttpError(400, "Enter a valid page range.");
    const [firstText, lastText] = part.split("-");
    const first = Number(firstText);
    const last = Number(lastText ?? firstText);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > MAX_PAGE_RANGE_PAGES) throw new HttpError(400, "Enter a valid page range.");
    if (totalPages !== null && last > totalPages) throw new HttpError(400, "Page range exceeds the document page count.");
    selectedPages += last - first + 1;
    if (selectedPages > MAX_PAGE_RANGE_PAGES) throw new HttpError(400, "Page range is too large.");
  }
}
async function readPdfPageCount(data: Buffer): Promise<number> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(new Uint8Array(data));
    const pages = pdf.getPageCount();
    if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGE_RANGE_PAGES) {
      throw new HttpError(422, "PDF page count could not be verified. Please save or re-export this PDF.");
    }
    return pages;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "PDF page count could not be verified. Please save or re-export this PDF.");
  }
}
function validatePrintMetadata(raw: unknown, uploadedFiles: StoredFile[]): Record<string, unknown> {
  const metadata = parseMetadata(raw);
  const shopCode = typeof metadata.shopCode === "string" ? metadata.shopCode : "";
  if (!/^\d{6}$/.test(shopCode)) throw new HttpError(400, "Enter a valid six-digit shop code.");
  if (!Array.isArray(metadata.files) || metadata.files.length !== uploadedFiles.length) throw new HttpError(400, "Print settings do not match the selected files.");
  const files = metadata.files.map(item => {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { rotation: normalizeRotation(entry.rotation) };
  });
  const canonicalFiles = files.map((settings, index) => {
    const pages = uploadedFiles[index].pages;
    if (pages === null) throw new HttpError(422, "PDF page count could not be verified. Please save or re-export this PDF.");
    return { ...settings, pages };
  });
  const pageMode = metadata.pageMode === "custom" ? "custom" : metadata.pageMode === "all" ? "all" : null;
  if (!pageMode) throw new HttpError(400, "Choose all pages or a custom range.");
  const totalPages = canonicalFiles.reduce((total, item) => total + item.pages, 0);
  const pageRange = typeof metadata.pageRange === "string" ? metadata.pageRange : "";
  if (pageMode === "custom") validatePageRange(pageRange, totalPages);
  const copies = Number(metadata.copies);
  if (!Number.isInteger(copies) || copies < 1 || copies > 99) throw new HttpError(400, "Copies must be between 1 and 99.");
  const color = metadata.color === "bw" ? "bw" : metadata.color === "colour" || metadata.color === "color" ? "colour" : null;
  if (!color) throw new HttpError(400, "Choose a valid colour mode.");
  const paper = typeof metadata.paper === "string" && metadata.paper.length <= 20 ? metadata.paper : "";
  const duplex = metadata.duplex === "single" || metadata.duplex === "double" ? metadata.duplex : null;
  const note = typeof metadata.note === "string" ? metadata.note.slice(0, 140) : "";
  if (!paper || !duplex) throw new HttpError(400, "Choose valid paper and single- or double-sided printing settings.");
  return { shopCode, files: canonicalFiles, pageMode, pageRange, copies, color, paper, duplex, note };
}
async function validateFiles(files: Express.Multer.File[], derivePageCounts = false): Promise<StoredFile[]> {
  if (!files.length) throw new HttpError(400, "Select at least one file.");
  const stored: StoredFile[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "File exceeds 25 MB limit.");
    const extension = path.extname(file.originalname).slice(1).toLowerCase();
    const expectedMime = MIME_BY_EXTENSION[extension];
    if (!expectedMime || (file.mimetype && file.mimetype !== expectedMime && file.mimetype !== "application/octet-stream")) {
      throw new HttpError(415, "Use a PDF, JPG, or PNG file.");
    }
    const data = file.buffer;
    const isPdf = data.length >= 5 && data.subarray(0, 5).equals(Buffer.from("%PDF-"));
    const isPng = data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const isJpeg = data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const matches = (extension === "pdf" && isPdf) || (extension === "png" && isPng) || ((extension === "jpg" || extension === "jpeg") && isJpeg);
    if (!matches) throw new HttpError(415, "File type could not be verified.");
    if (isPdf && data.toString("latin1").includes("/Encrypt")) throw new HttpError(422, "Protected PDF. Please remove password before upload.");
    const pages = derivePageCounts ? (isPdf ? await readPdfPageCount(data) : 1) : null;
    stored.push({ id: randomBytes(12).toString("hex"), name: path.basename(file.originalname).slice(0, 180), type: expectedMime, size: file.size, bytes: data, pages });
  }
  return stored;
}
function publicFile(file: StoredFile) { return { id: file.id, name: file.name, type: file.type, size: file.size, ...(file.pages === null ? {} : { pages: file.pages }) }; }
function isActive(session: SessionBase) { return Date.now() < session.expiresAt; }
function getPrintJob(code: string) {
  const job = jobs.get(code.toUpperCase());
  if (!job || !validCode(job.code) || !isActive(job)) throw new HttpError(404, "No active job was found for that code.");
  return job;
}
function getShareJob(code: string) {
  const job = shareJobs.get(code.toUpperCase());
  if (!job || !validCode(job.code) || !isActive(job)) throw new HttpError(404, "No active handoff was found for that code.");
  return job;
}
function bearerMatches(req: Request, expected: string) {
  const supplied = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return supplied.length === expected.length && supplied === expected;
}
function getOwnedPrintJob(req: Request) {
  const job = jobs.get(req.params.code.toUpperCase());
  if (!job || !validCode(job.code) || Date.now() >= job.expiresAt + RENEWAL_WINDOW_MS) throw new HttpError(404, "Job not found.");
  if (!bearerMatches(req, job.ownerToken)) throw new HttpError(403, "This payment update is not authorized.");
  return job;
}
function getActiveOwnedPrintJob(req: Request) {
  const job = getOwnedPrintJob(req);
  if (!isActive(job)) throw new HttpError(409, "Code expired. Renew this job before changing or confirming payment.");
  return job;
}
function getDemoQuote(job: PrintJob): DemoQuote {
  return quoteDemoJob({
    shopCode: job.metadata.shopCode,
    files: job.files.map(file => ({ pages: file.pages })),
    pageMode: job.metadata.pageMode,
    pageRange: job.metadata.pageRange,
    color: job.metadata.color,
    paper: job.metadata.paper,
    copies: job.metadata.copies,
  });
}
function rateLimit(map: Map<string, { startedAt: number; count: number }>, limit: number, message: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || "unknown";
    const current = map.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      map.set(key, { startedAt: now, count: 1 });
      next();
      return;
    }
    current.count += 1;
    if (current.count > limit) { res.status(429).json({ error: message }); return; }
    next();
  };
}
const limitCodeLookups = rateLimit(lookupAttempts, 30, "Too many code lookups. Try again in a minute.");
const limitUploads = rateLimit(uploadAttempts, 15, "Too many uploads. Try again in a minute.");
function reserveUpload(req: Request, res: Response, next: NextFunction) {
  if (inFlightUploads >= MAX_IN_FLIGHT_UPLOADS) { res.status(503).json({ error: "Temporary upload capacity is busy. Please retry shortly." }); return; }
  inFlightUploads += 1;
  let released = false;
  const release = () => { if (!released) { released = true; inFlightUploads -= 1; } };
  res.once("finish", release);
  res.once("close", release);
  next();
}
function storedByteCount() {
  const allFiles = [...Array.from(jobs.values()).flatMap(job => job.files), ...Array.from(shareJobs.values()).flatMap(job => job.files)];
  return allFiles.reduce((total, file) => total + file.size, 0);
}
function assertCapacity(files: StoredFile[]) {
  if (jobs.size + shareJobs.size >= MAX_ACTIVE_SESSIONS) throw new HttpError(503, "Temporary handoff capacity is full. Please try again later.");
  const incoming = files.reduce((total, file) => total + file.size, 0);
  if (storedByteCount() + incoming > MAX_STORED_BYTES) throw new HttpError(503, "Temporary upload storage is full. Please try again later.");
}
function sendPrivateFile(res: Response, file: StoredFile) {
  const safeName = encodeURIComponent(file.name);
  res.set({
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": file.type,
    "Content-Length": String(file.size),
    "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`,
  });
  res.end(file.bytes);
}
function readFileId(files: StoredFile[], id: string) {
  const file = files.find(item => item.id === id);
  if (!file) throw new HttpError(404, "File not found.");
  return file;
}
function deletePrintJob(job: PrintJob) {
  jobs.delete(job.code);
  if (jobByClientId.get(job.clientSessionId) === job.code) jobByClientId.delete(job.clientSessionId);
}
function deleteShareJob(job: ShareJob) {
  shareJobs.delete(job.code);
  if (shareByClientId.get(job.clientSessionId) === job.code) shareByClientId.delete(job.clientSessionId);
}
function cleanExpiredSessions() {
  const now = Date.now();
  for (const job of Array.from(jobs.values())) if (job.expiresAt + RENEWAL_WINDOW_MS <= now) deletePrintJob(job);
  for (const job of Array.from(shareJobs.values())) if (job.expiresAt + RENEWAL_WINDOW_MS <= now) deleteShareJob(job);
  for (const [ip, window] of Array.from(lookupAttempts.entries())) if (now - window.startedAt >= 60_000) lookupAttempts.delete(ip);
  for (const [ip, window] of Array.from(uploadAttempts.entries())) if (now - window.startedAt >= 60_000) uploadAttempts.delete(ip);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const staticPath = process.env.NODE_ENV === "production"
    ? path.resolve(__dirname, "public")
    : path.resolve(__dirname, "..", "dist", "public");

  app.disable("x-powered-by");
  app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.use(express.json({ limit: "32kb" }));
  const janitor = setInterval(cleanExpiredSessions, 60_000);
  janitor.unref();

  app.get("/api/health", (_req, res) => res.status(200).json({ ok: true }));

  app.post("/api/jobs", limitUploads, reserveUpload, upload.array("files", MAX_FILES), async (req, res, next) => {
    try {
      const files = (req.files ?? []) as Express.Multer.File[];
      const clientSessionId = typeof req.body.clientSessionId === "string" ? req.body.clientSessionId.slice(0, 100) : "";
      if (!clientSessionId) throw new HttpError(400, "Upload session is missing.");
      const existingCode = jobByClientId.get(clientSessionId);
      const existingJob = existingCode ? jobs.get(existingCode) : undefined;
      if (existingJob && isActive(existingJob)) {
        res.status(200).json({ code: existingJob.code, expiresAt: existingJob.expiresAt, ownerToken: existingJob.ownerToken, files: existingJob.files.map(publicFile) });
        return;
      }
      const storedFiles = await validateFiles(files, true);
      const metadata = validatePrintMetadata(req.body.metadata, storedFiles);
      assertCapacity(storedFiles);
      const now = Date.now();
      const job: PrintJob = {
        code: uniqueCode(), files: storedFiles, createdAt: now, expiresAt: now + SESSION_MS,
        clientSessionId, ownerToken: randomBytes(32).toString("base64url"), renewals: [], metadata,
        payment: { method: null, status: "unselected", amount: null, upiUri: null, confirmedAt: null },
      };
      jobs.set(job.code, job);
      jobByClientId.set(clientSessionId, job.code);
      res.status(201).json({ code: job.code, expiresAt: job.expiresAt, ownerToken: job.ownerToken, files: job.files.map(publicFile) });
    } catch (error) { next(error); }
  });

  app.get("/api/jobs/:code", limitCodeLookups, (req, res, next) => {
    try {
      const job = getPrintJob(req.params.code);
      res.json({ code: job.code, expiresAt: job.expiresAt, files: job.files.map(publicFile), settings: job.metadata });
    } catch (error) { next(error); }
  });

  app.put("/api/jobs/:code/settings", (req, res, next) => {
    try {
      const job = jobs.get(req.params.code.toUpperCase());
      if (!job || Date.now() >= job.expiresAt + RENEWAL_WINDOW_MS) throw new HttpError(404, "Job not found.");
      if (!bearerMatches(req, job.ownerToken)) throw new HttpError(403, "This settings update is not authorized.");
      if (job.payment.status !== "unselected") throw new HttpError(409, "Print settings cannot change after payment starts.");
      job.metadata = validatePrintMetadata(req.body, job.files);
      res.json({ ok: true, settings: job.metadata });
    } catch (error) { next(error); }
  });

  app.get("/api/jobs/:code/payment-options", (req, res, next) => {
    try {
      const job = getActiveOwnedPrintJob(req);
      res.json(getDemoQuote(job));
    } catch (error) { next(error); }
  });

  app.post("/api/jobs/:code/payment-intent", (req, res, next) => {
    try {
      const job = getActiveOwnedPrintJob(req);
      if (job.payment.status === "paid") throw new HttpError(409, "This demo job is already marked paid.");
      const quote = getDemoQuote(job);
      if (!quote.available) throw new HttpError(422, "Online payment is not configured for this demo shop. Choose pay at counter.");
      const upiUri = buildDemoUpiUri(job.code, quote);
      job.payment = { method: "upi", status: "pending", amount: quote.amount, upiUri, confirmedAt: null };
      res.json({ demo: true, quote, payment: job.payment, upiUri });
    } catch (error) { next(error); }
  });

  app.post("/api/jobs/:code/payment-choice", (req, res, next) => {
    try {
      const job = getActiveOwnedPrintJob(req);
      if (req.body?.method !== "offline") throw new HttpError(400, "Choose UPI or pay at counter.");
      if (job.payment.status === "paid") throw new HttpError(409, "This demo job is already marked paid.");
      const quote = getDemoQuote(job);
      job.payment = { method: "offline", status: "pending", amount: quote.available ? quote.amount : null, upiUri: null, confirmedAt: null };
      res.json({ demo: true, quote, payment: job.payment });
    } catch (error) { next(error); }
  });

  app.get("/api/jobs/:code/payment", (req, res, next) => {
    try {
      const job = getActiveOwnedPrintJob(req);
      res.json({ demo: true, payment: job.payment });
    } catch (error) { next(error); }
  });

  app.post("/api/jobs/:code/demo-payment-done", (req, res, next) => {
    try {
      const job = getActiveOwnedPrintJob(req);
      if (!job.payment.method || job.payment.status !== "pending") throw new HttpError(409, "Choose a payment method before confirming this demo job.");
      job.payment = { ...job.payment, status: "paid", confirmedAt: Date.now() };
      res.json({ demo: true, payment: job.payment });
    } catch (error) { next(error); }
  });

  app.post("/api/jobs/:code/renew", (req, res, next) => {
    try {
      const job = jobs.get(req.params.code.toUpperCase());
      if (!job || !validCode(job.code) || Date.now() >= job.expiresAt + RENEWAL_WINDOW_MS) throw new HttpError(404, "Job not found.");
      if (!bearerMatches(req, job.ownerToken)) throw new HttpError(403, "This renewal is not authorized.");
      if (isActive(job)) throw new HttpError(409, "Code is still active.");
      const now = Date.now();
      job.renewals = job.renewals.filter(time => time > now - RENEWAL_WINDOW_MS);
      if (job.renewals.length >= MAX_RENEWALS_PER_WINDOW) throw new HttpError(429, "Renewal limit reached. Please ask the shop for help.");
      job.renewals.push(now);
      job.expiresAt = now + SESSION_MS;
      res.json({ code: job.code, expiresAt: job.expiresAt, ownerToken: job.ownerToken, files: job.files.map(publicFile) });
    } catch (error) { next(error); }
  });

  app.delete("/api/jobs/:code", (req, res, next) => {
    try {
      const job = jobs.get(req.params.code.toUpperCase());
      if (!job) throw new HttpError(404, "Job not found.");
      if (!bearerMatches(req, job.ownerToken)) throw new HttpError(403, "This deletion is not authorized.");
      deletePrintJob(job);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/jobs/:code/files/:fileId", limitCodeLookups, (req, res, next) => {
    try { const job = getPrintJob(req.params.code); sendPrivateFile(res, readFileId(job.files, req.params.fileId)); }
    catch (error) { next(error); }
  });

  app.post("/api/shares", limitUploads, reserveUpload, upload.array("files", MAX_FILES), async (req, res, next) => {
    try {
      const files = (req.files ?? []) as Express.Multer.File[];
      const clientSessionId = typeof req.body.clientSessionId === "string" ? req.body.clientSessionId.slice(0, 100) : "";
      if (!clientSessionId) throw new HttpError(400, "Upload session is missing.");
      const existingCode = shareByClientId.get(clientSessionId);
      const existingShare = existingCode ? shareJobs.get(existingCode) : undefined;
      if (existingShare && isActive(existingShare)) {
        res.status(200).json({ code: existingShare.code, expiresAt: existingShare.expiresAt, ownerToken: existingShare.ownerToken, files: existingShare.files.map(publicFile) });
        return;
      }
      const storedFiles = await validateFiles(files);
      assertCapacity(storedFiles);
      const now = Date.now();
      const share: ShareJob = {
        code: uniqueCode(), files: storedFiles, createdAt: now, expiresAt: now + SESSION_MS,
        clientSessionId, ownerToken: randomBytes(32).toString("base64url"), renewals: [],
      };
      shareJobs.set(share.code, share);
      shareByClientId.set(clientSessionId, share.code);
      res.status(201).json({ code: share.code, expiresAt: share.expiresAt, ownerToken: share.ownerToken, files: share.files.map(publicFile) });
    } catch (error) { next(error); }
  });

  app.get("/api/shares/:code", limitCodeLookups, (req, res, next) => {
    try { const share = getShareJob(req.params.code); res.json({ code: share.code, expiresAt: share.expiresAt, files: share.files.map(publicFile) }); }
    catch (error) { next(error); }
  });

  app.post("/api/shares/:code/renew", (req, res, next) => {
    try {
      const share = shareJobs.get(req.params.code.toUpperCase());
      if (!share || !validCode(share.code) || Date.now() >= share.expiresAt + RENEWAL_WINDOW_MS) throw new HttpError(404, "Share not found.");
      if (!bearerMatches(req, share.ownerToken)) throw new HttpError(403, "This renewal is not authorized.");
      if (isActive(share)) throw new HttpError(409, "Code is still active.");
      const now = Date.now();
      share.renewals = share.renewals.filter(time => time > now - RENEWAL_WINDOW_MS);
      if (share.renewals.length >= MAX_RENEWALS_PER_WINDOW) throw new HttpError(429, "Renewal limit reached. Please create a new share.");
      share.renewals.push(now);
      share.expiresAt = now + SESSION_MS;
      res.json({ code: share.code, expiresAt: share.expiresAt, ownerToken: share.ownerToken, files: share.files.map(publicFile) });
    } catch (error) { next(error); }
  });

  app.delete("/api/shares/:code", (req, res, next) => {
    try {
      const share = shareJobs.get(req.params.code.toUpperCase());
      if (!share) throw new HttpError(404, "Share not found.");
      if (!bearerMatches(req, share.ownerToken)) throw new HttpError(403, "This deletion is not authorized.");
      deleteShareJob(share);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/shares/:code/files/:fileId", limitCodeLookups, (req, res, next) => {
    try { const share = getShareJob(req.params.code); sendPrivateFile(res, readFileId(share.files, req.params.fileId)); }
    catch (error) { next(error); }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const message = error.code === "LIMIT_FILE_SIZE" ? "File exceeds 25 MB limit." : "Select up to 10 files per job.";
      res.status(status).json({ error: message });
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error && error.message ? error.message : "Upload failed. Please try again.";
    res.status(status).json({ error: status < 500 ? message : "Upload failed. Please try again." });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
  app.use(express.static(staticPath, { setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html") || filePath.endsWith("manus-routes.json")) res.setHeader("Cache-Control", "no-store");
  } }));
  app.get("*", (_req, res) => res.sendFile(path.join(staticPath, "index.html")));
  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () => console.log(`QwickR1 server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exitCode = 1; });
