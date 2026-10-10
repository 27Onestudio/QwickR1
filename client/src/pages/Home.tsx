import { ChangeEvent, DragEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Camera, Check, ChevronDown, CircleAlert, Clock3, Copy,
  Download, FileText, History, Image as ImageIcon, Info, LockKeyhole, LogIn, LogOut, MapPin, Minus, Phone, Plus,
  QrCode, RefreshCw, ScanLine, Send, ShieldCheck, Smartphone, UploadCloud, UserRound, X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { countPagesInRange, rotateFile, validateClientFile } from "../lib/fileValidation";
import { sendFiles, type UploadedFile } from "../lib/uploadClient";
import { DemoPaymentPanel, type DemoPaymentMethod, type DemoPaymentStatus, type DemoQuote } from "../components/DemoPaymentPanel";
import { ManualPrintHistoryPanel, type ManualPrintEntry } from "../components/ManualPrintHistoryPanel";

type Mode = "home" | "print" | "share" | "transactions" | "info";
type InfoTab = "cookies" | "terms" | "privacy" | "liability" | "about";
type ShareTab = "sending" | "receiving";
type PrintStage = "shop" | "upload" | "settings" | "review" | "code" | "done";
type SelectedFile = { name: string; size: number; type: string; pages: number | null; rotation: number };
type Transaction = { id: string; kind: "Print job" | "Share file"; title: string; note: string; amount: number | null; date: string; status: string; createdAt?: number; paid?: boolean; paymentMethod?: DemoPaymentMethod | null };
type PaymentSnapshot = { method: DemoPaymentMethod | null; status: DemoPaymentStatus; amount: number | null; upiUri: string | null; confirmedAt: number | null };
type SharedItem = UploadedFile;
type ShareRecord = { code: string; expiresAt: number; files: SharedItem[] };
const MAX = 25 * 1024 * 1024;
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const exts = ".pdf,.jpg,.jpeg,.png";
function bytes(n: number) { return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`; }
function makeClientId() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function QR({ value }: { value: string }) { return <QRCodeSVG className="qr-svg simple-qr" value={value} size={168} title={`QwickR1 code ${value}`} />; }
function transactionAmountLabel(tx: Transaction) {
  if (tx.kind === "Share file") return "File share";
  if (typeof tx.amount !== "number" || !Number.isFinite(tx.amount)) return tx.paid ? "Paid at counter · amount not logged" : "Price confirmed at counter";
  return tx.paid ? `₹${tx.amount.toFixed(2)}` : "Payment pending";
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("home");
  const [infoTab, setInfoTab] = useState<InfoTab>("privacy");
  const [shareTab, setShareTab] = useState<ShareTab>("sending");
  const [printStage, setPrintStage] = useState<PrintStage>("shop");
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [printFiles, setPrintFiles] = useState<SelectedFile[]>([]);
  const [printSourceFiles, setPrintSourceFiles] = useState<File[]>([]);
  const [pageMode, setPageMode] = useState<"all" | "custom">("all");
  const [pageRange, setPageRange] = useState("");
  const [shareFiles, setShareFiles] = useState<SelectedFile[]>([]);
  const [shareSourceFiles, setShareSourceFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadInterrupted, setUploadInterrupted] = useState(false);
  const [shareUploadInterrupted, setShareUploadInterrupted] = useState(false);
  const [jobExpiresAt, setJobExpiresAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [ownerToken, setOwnerToken] = useState("");
  const [renewing, setRenewing] = useState(false);
  const [shareExpiresAt, setShareExpiresAt] = useState<number | null>(null);
  const [shareSecondsRemaining, setShareSecondsRemaining] = useState(0);
  const [shareOwnerToken, setShareOwnerToken] = useState("");
  const [shareRenewing, setShareRenewing] = useState(false);
  const [selectedShopCode, setSelectedShopCode] = useState("");
  const [color, setColor] = useState<"bw" | "colour">("bw");
  const [copies, setCopies] = useState(1);
  const [paper, setPaper] = useState("A4");
  const [duplex, setDuplex] = useState("double");
  const [note, setNote] = useState("");
  const [pickup, setPickup] = useState("");
  const [demoQuote, setDemoQuote] = useState<DemoQuote | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<DemoPaymentMethod | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<DemoPaymentStatus>("unselected");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [generatingCode, setGeneratingCode] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [receivedCode, setReceivedCode] = useState("");
  const [receivedFile, setReceivedFile] = useState<ShareRecord | null>(null);
  const [shareError, setShareError] = useState("");
  const [copied, setCopied] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPurpose, setCameraPurpose] = useState<"shop" | "share">("shop");
  const [cameraMessage, setCameraMessage] = useState("Point your camera at a QwickR1 QR code.");
  const printClientId = useRef(makeClientId());
  const shareClientId = useRef(makeClientId());

  const [publicRecent, setPublicRecent] = useState<Transaction[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimer = useRef<number | null>(null);
  const [signedIn, setSignedIn] = useState(() => localStorage.getItem("qwickr1-signed-in") === "true");
  const [profileName, setProfileName] = useState(() => localStorage.getItem("qwickr1-profile") || "");
  const [profileEmail, setProfileEmail] = useState(() => localStorage.getItem("qwickr1-email") || "");
  const [showSignIn, setShowSignIn] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>(() => { try { return JSON.parse(localStorage.getItem("qwickr1-transactions") || "[]"); } catch { return []; } });
  const [manualPrintEntries, setManualPrintEntries] = useState<ManualPrintEntry[]>(() => { try { return JSON.parse(localStorage.getItem("qwickr1-manual-print-history") || "[]"); } catch { return []; } });
  const input = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const contactInput = useRef<HTMLInputElement>(null);
  const shopCodeInput = useRef<HTMLInputElement>(null);
  const receivedCodeInput = useRef<HTMLInputElement>(null);

  useEffect(() => { try { const all: Transaction[] = JSON.parse(localStorage.getItem("qwickr1-transactions") || "[]"); setPublicRecent(all.slice(0, 3)); } catch { setPublicRecent([]); } }, [transactions]);
  useEffect(() => { if (!jobExpiresAt) { setSecondsRemaining(0); return; } const tick = () => setSecondsRemaining(Math.max(0, Math.ceil((jobExpiresAt - Date.now()) / 1000))); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); }, [jobExpiresAt]);
  useEffect(() => { if (!shareExpiresAt) { setShareSecondsRemaining(0); return; } const tick = () => setShareSecondsRemaining(Math.max(0, Math.ceil((shareExpiresAt - Date.now()) / 1000))); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); }, [shareExpiresAt]);
  useEffect(() => {
    if (printStage !== "code" || !pickup || !ownerToken || paymentStatus !== "pending") return;
    let active = true;
    const syncPayment = async () => {
      try {
        const response = await fetch(`/api/jobs/${pickup}/payment`, { headers: { Authorization: `Bearer ${ownerToken}` }, cache: "no-store" });
        const payload = await response.json() as { payment?: PaymentSnapshot };
        if (!active || !response.ok || !payload.payment) return;
        const payment = payload.payment;
        setPaymentMethod(payment.method);
        if (payment.status === "paid") {
          setPaymentStatus("paid");
          const confirmedAt = payment.confirmedAt ?? Date.now();
          setTransactions(previous => {
            const next = previous.map(tx => tx.id === pickup ? { ...tx, amount: payment.amount, paymentMethod: payment.method, paid: true, createdAt: confirmedAt, date: new Date(confirmedAt).toLocaleDateString("en-IN"), status: "Payment Done · demo" } : tx);
            localStorage.setItem("qwickr1-transactions", JSON.stringify(next));
            return next;
          });
        }
      } catch { /* remain pending and try again */ }
    };
    void syncPayment();
    const timer = window.setInterval(() => void syncPayment(), 2000);
    window.addEventListener("focus", syncPayment);
    document.addEventListener("visibilitychange", syncPayment);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", syncPayment); document.removeEventListener("visibilitychange", syncPayment); };
  }, [printStage, pickup, ownerToken, paymentStatus]);
  useEffect(() => () => { if (scanTimer.current) window.clearInterval(scanTimer.current); streamRef.current?.getTracks().forEach(track => track.stop()); }, []);
  const stopCamera = () => { if (scanTimer.current) window.clearInterval(scanTimer.current); scanTimer.current = null; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setCameraOpen(false); };
  const startCamera = async (purpose: "shop" | "share") => { setCameraPurpose(purpose); setCameraMessage("Point your camera at a QwickR1 QR code."); setCameraOpen(true); try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); streamRef.current = stream; window.setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50); const Detector = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector; if (!Detector) { setCameraMessage("Camera is open. If QR scanning is unavailable on this browser, enter the code manually below."); return; } const detector = new Detector({ formats: ["qr_code"] }); scanTimer.current = window.setInterval(async () => { if (!videoRef.current || videoRef.current.readyState < 2) return; try { const results = await detector.detect(videoRef.current); const value = results[0]?.rawValue; if (value) { stopCamera(); if (purpose === "shop") { const code = value.match(/\d{6}/)?.[0] ?? ""; if (code) { setSelectedShopCode(code); setError(""); goUpload(); } else { setError("This shop QR must include a six-digit shop code."); setPrintStage("shop"); } } else { void findShareValue(value.replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/gi, "").toUpperCase().slice(0, 6)); } } } catch { /* camera frame not ready */ } }, 450); } catch { setCameraMessage("Camera permission was not granted. You can enter the six-character code manually."); } };
  const totalPages = printFiles.length === 0 ? 0 : printFiles.some(item => item.pages === null) ? null : printFiles.reduce((total, item) => total + (item.pages ?? 0), 0);
  const selectedPages = pageMode === "custom" ? countPagesInRange(pageRange, totalPages) : totalPages;
  const pageRangeValid = pageMode === "all" || selectedPages !== null;
  const monthNow = new Date();
  const isThisMonth = (timestamp: number) => { const date = new Date(timestamp); return date.getFullYear() === monthNow.getFullYear() && date.getMonth() === monthNow.getMonth(); };
  const monthlyExpenseTotal = manualPrintEntries.filter(entry => Number.isFinite(entry.createdAt) && isThisMonth(entry.createdAt)).reduce((sum, entry) => sum + entry.amount, 0)
    + transactions.filter(tx => tx.kind === "Print job" && tx.paid === true && typeof tx.amount === "number" && Number.isFinite(tx.amount) && typeof tx.createdAt === "number" && isThisMonth(tx.createdAt)).reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
  const timeLabel = `${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  const shareTimeLabel = `${String(Math.floor(shareSecondsRemaining / 60)).padStart(2, "0")}:${String(shareSecondsRemaining % 60).padStart(2, "0")}`;
  const discardPrintJob = () => { if (pickup && ownerToken) void fetch(`/api/jobs/${pickup}`, { method: "DELETE", headers: { Authorization: `Bearer ${ownerToken}` } }).catch(() => {}); setPickup(""); setOwnerToken(""); setJobExpiresAt(null); setDemoQuote(null); setPaymentMethod(null); setPaymentStatus("unselected"); setPaymentError(""); printClientId.current = makeClientId(); };
  const discardShare = () => { if (shareCode && shareOwnerToken) void fetch(`/api/shares/${shareCode}`, { method: "DELETE", headers: { Authorization: `Bearer ${shareOwnerToken}` } }).catch(() => {}); setShareCode(""); setShareOwnerToken(""); setShareExpiresAt(null); shareClientId.current = makeClientId(); };
  const processFiles = async (files: File[], share = false) => {
    setError("");
    if (!files.length) return;
    const selected: SelectedFile[] = [];
    for (const source of files) {
      const checked = await validateClientFile(source);
      if (checked.error) { setError(checked.error); return; }
      selected.push({ name: source.name, size: source.size, type: source.type, pages: checked.pages, rotation: 0 });
    }
    if (share) {
      discardShare();
      setShareSourceFiles(previous => [...previous, ...files]);
      setShareFiles(previous => [...previous, ...selected]);
      setShareUploadInterrupted(false);
      setShareCode("");
      setShareExpiresAt(null);
    } else {
      discardPrintJob();
      setPrintSourceFiles(previous => [...previous, ...files]);
      setPrintFiles(previous => [...previous, ...selected]);
      setFile(previous => previous ?? selected[0] ?? null);
      setSourceFile(previous => previous ?? files[0] ?? null);
      setUploadInterrupted(false);
    }
  };
  const process = (f?: File) => { if (f) void processFiles([f], false); };
  const processShareFiles = (files: File[]) => { void processFiles(files, true); };
  const drop = (e: DragEvent<HTMLDivElement>, share = false) => { e.preventDefault(); setDragging(false); share ? processShareFiles(Array.from(e.dataTransfer.files || [])) : void processFiles(Array.from(e.dataTransfer.files || []), false); };
  const change = (e: ChangeEvent<HTMLInputElement>, share = false) => { const files = Array.from(e.target.files || []); share ? processShareFiles(files) : void processFiles(files, false); e.target.value = ""; };
  const removeFileAt = (index: number, share = false) => {
    if (share) {
      setShareFiles(previous => previous.filter((_, current) => current !== index));
      setShareSourceFiles(previous => previous.filter((_, current) => current !== index));
      discardShare();
    } else {
      discardPrintJob();
      const nextFiles = printFiles.filter((_, current) => current !== index);
      const nextSources = printSourceFiles.filter((_, current) => current !== index);
      setPrintFiles(nextFiles); setPrintSourceFiles(nextSources);
      setFile(nextFiles[0] ?? null); setSourceFile(nextSources[0] ?? null);

    }
    setError("");
  };
  const rotateSelectedFile = (index: number) => { discardPrintJob(); setPrintFiles(previous => previous.map((entry, current) => current === index ? { ...entry, rotation: (entry.rotation + 90) % 360 } : entry)); };
  const clear = () => {
    discardPrintJob(); discardShare(); setSelectedShopCode("");
    setFile(null); setSourceFile(null); setPrintFiles([]); setPrintSourceFiles([]); setShareFiles([]); setShareSourceFiles([]);
    setError(""); setProgress(0); setUploadInterrupted(false); setShareUploadInterrupted(false);
    setPickup(""); setOwnerToken(""); setJobExpiresAt(null); setShareCode(""); setShareOwnerToken(""); setShareExpiresAt(null);
    printClientId.current = makeClientId(); shareClientId.current = makeClientId();
  };
  const openPrint = () => { setMode("print"); setPrintStage("shop"); setSelectedShopCode(""); setError(""); setDemoQuote(null); setPaymentMethod(null); setPaymentStatus("unselected"); setPaymentError(""); };
  const openShare = () => { setMode("share"); setShareTab("sending"); };
  const goUpload = () => { setPrintStage("upload"); };
  const goBack = () => { if (printStage === "upload") setPrintStage("shop"); else if (printStage === "settings") setPrintStage("upload"); else if (printStage === "review") setPrintStage("settings"); };
  const addTransaction = (tx: Transaction) => { setTransactions(prev => { const next = [tx, ...prev]; localStorage.setItem("qwickr1-transactions", JSON.stringify(next)); return next; }); };
  const updateTransaction = (id: string, patch: Partial<Transaction>) => { setTransactions(previous => { const next = previous.map(tx => tx.id === id ? { ...tx, ...patch } : tx); localStorage.setItem("qwickr1-transactions", JSON.stringify(next)); return next; }); };
  const addManualPrintEntry = (entryNote: string, amount: number) => { if (!signedIn) { setShowSignIn(true); return; } setManualPrintEntries(previous => { const next = [{ id: makeClientId(), note: entryNote, amount, createdAt: Date.now() }, ...previous]; localStorage.setItem("qwickr1-manual-print-history", JSON.stringify(next)); return next; }); };
  const startPrintUpload = async () => {
    if (!printSourceFiles.length || uploading) return;
    setError(""); setUploadInterrupted(false); setUploading(true); setProgress(0);
    try {
      const prepared = await Promise.all(printSourceFiles.map((source, index) => rotateFile(source, printFiles[index]?.rotation ?? 0)));
      if (prepared.some(source => source.size > MAX)) throw new Error("File exceeds 25 MB limit.");
      const result = await sendFiles("/api/jobs", prepared, {
        shopCode: selectedShopCode, files: printFiles.map(item => ({ rotation: 0, pages: item.pages })), pageMode, pageRange,
        color, copies, paper, duplex, note: note.slice(0, 140),
      }, printClientId.current, setProgress);
      if (result.files.length !== prepared.length || result.files.some(item => typeof item.pages !== "number" || !Number.isInteger(item.pages) || item.pages < 1)) {
        throw new Error("The page count could not be verified. Please choose another PDF.");
      }
      setPrintFiles(previous => previous.map((item, index) => ({ ...item, pages: result.files[index].pages as number })));
      setPickup(result.code); setOwnerToken(result.ownerToken ?? ""); setJobExpiresAt(Number(result.expiresAt));
      setUploadInterrupted(false); setPrintStage("settings");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Upload interrupted. Tap to Retry.";
      setError(message); setUploadInterrupted(message === "Upload interrupted. Tap to Retry.");
    } finally { setUploading(false); }
  };
  const savePrintSettings = async () => {
    if (!pickup || !ownerToken) { setError("Upload the selected files before saving print settings."); return; }
    setError("");
    try {
      const response = await fetch(`/api/jobs/${pickup}/settings`, { method: "PUT", headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ shopCode: selectedShopCode, files: printFiles.map(item => ({ rotation: 0, pages: item.pages })), pageMode, pageRange, color, copies, paper, duplex, note: note.slice(0, 140) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save print settings. Tap to Retry.");
      try {
        const quoteResponse = await fetch(`/api/jobs/${pickup}/payment-options`, { headers: { Authorization: `Bearer ${ownerToken}` }, cache: "no-store" });
        const quote = await quoteResponse.json() as DemoQuote;
        setDemoQuote(quoteResponse.ok ? quote : null);
      } catch { setDemoQuote(null); }
      setPrintStage("review");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save print settings. Tap to Retry."); }
  };
  const renewCode = async () => {
    if (!pickup || !ownerToken || renewing) return;
    setRenewing(true); setError("");
    try {
      const response = await fetch(`/api/jobs/${pickup}/renew`, { method: "POST", headers: { Authorization: `Bearer ${ownerToken}` }, cache: "no-store" });
      const payload = await response.json() as { code?: string; expiresAt?: number; error?: string };
      if (!response.ok || !payload.expiresAt) throw new Error(payload.error || "Could not renew this code.");
      setPickup(payload.code || pickup); setJobExpiresAt(payload.expiresAt); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not renew this code."); }
    finally { setRenewing(false); }
  };
  const renewShareCode = async () => {
    if (!shareCode || !shareOwnerToken || shareRenewing) return;
    setShareRenewing(true); setShareError("");
    try {
      const response = await fetch(`/api/shares/${shareCode}/renew`, { method: "POST", headers: { Authorization: `Bearer ${shareOwnerToken}` }, cache: "no-store" });
      const payload = await response.json() as { code?: string; expiresAt?: number; error?: string };
      if (!response.ok || !payload.expiresAt) throw new Error(payload.error || "Could not renew this code.");
      setShareCode(payload.code || shareCode); setShareExpiresAt(payload.expiresAt);
    } catch (cause) { setShareError(cause instanceof Error ? cause.message : "Could not renew this code."); }
    finally { setShareRenewing(false); }
  };
  const startAnotherShare = () => { discardShare(); setShareFiles([]); setShareSourceFiles([]); setShareError(""); setError(""); };
  const createShare = async () => {
    if (!shareFiles.length || !shareSourceFiles.length || uploading) return;
    setError(""); setShareUploadInterrupted(false); setUploading(true); setProgress(0);
    try {
      const result = await sendFiles("/api/shares", shareSourceFiles, {}, shareClientId.current, setProgress);
      setShareCode(result.code); setShareOwnerToken(result.ownerToken ?? ""); setShareExpiresAt(Number(result.expiresAt)); setReceivedFile(null);
      addTransaction({ id: result.code, kind: "Share file", title: shareFiles.length === 1 ? shareFiles[0].name : `${shareFiles.length} files`, note: `Device-to-device share · ${shareFiles.length} file${shareFiles.length === 1 ? "" : "s"}`, amount: 0, date: "Just now", status: "Share code generated" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Upload interrupted. Tap to Retry.";
      setError(message); setShareUploadInterrupted(message === "Upload interrupted. Tap to Retry.");
    } finally { setUploading(false); }
  };
  const findShareValue = async (value: string) => {
    setShareError("");
    const normalized = value.toUpperCase();
    if (!new RegExp(`^[${CODE_CHARS}]{6}$`).test(normalized)) { setShareError("Enter the full six-character share code."); return; }
    try {
      const response = await fetch(`/api/shares/${normalized}`, { cache: "no-store" });
      const payload = await response.json() as ShareRecord & { error?: string };
      if (!response.ok || !Array.isArray(payload.files)) throw new Error(payload.error || "No active handoff was found for that code.");
      setReceivedCode(normalized); setShareCode(normalized); setReceivedFile(payload);
    } catch (cause) { setShareError(cause instanceof Error ? cause.message : "This handoff could not be opened. Try the code again."); setReceivedFile(null); }
  };
  const findShare = () => { void findShareValue((receivedCodeInput.current?.value || "").toUpperCase().replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, "").slice(0, 6)); };
  const downloadReceived = async () => {
    if (!receivedFile) return;
    setShareError("");
    try {
      for (const item of receivedFile.files) {
        const response = await fetch(`/api/shares/${receivedFile.code}/files/${item.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error("This handoff has expired. Ask the sender for a new code.");
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a"); link.href = objectUrl; link.download = item.name; link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (cause) { setShareError(cause instanceof Error ? cause.message : "Could not download this handoff."); }
  };
  const signIn = () => { const name = nameInput.current?.value.trim() || ""; const contact = contactInput.current?.value.trim() || ""; if (!name || !contact) return; setProfileName(name); setProfileEmail(contact); setSignedIn(true); localStorage.setItem("qwickr1-signed-in", "true"); localStorage.setItem("qwickr1-profile", name); localStorage.setItem("qwickr1-email", contact); setShowSignIn(false); setMode("transactions"); };
  const signOut = () => { setSignedIn(false); setMode("home"); setShowSignIn(false); localStorage.removeItem("qwickr1-signed-in"); };
  const completePrint = async () => { if (paymentStatus !== "paid") { setPaymentError("Wait for the shopkeeper to confirm payment before collecting this demo job."); return; } if (pickup && ownerToken) { try { await fetch(`/api/jobs/${pickup}`, { method: "DELETE", headers: { Authorization: `Bearer ${ownerToken}` } }); } catch { /* expiry cleanup remains the fallback */ } } setPrintStage("done"); };
  const generate = async () => {
    if (!pickup || generatingCode) return;
    setGeneratingCode(true); setPaymentError(""); setPaymentStatus("unselected"); setPaymentMethod(null);
    let quote: DemoQuote | null = null;
    try {
      const response = await fetch(`/api/jobs/${pickup}/payment-options`, { headers: { Authorization: `Bearer ${ownerToken}` }, cache: "no-store" });
      const payload = await response.json() as DemoQuote & { error?: string };
      if (response.ok) quote = payload;
      else setPaymentError(payload.error || "Demo price is unavailable. You can still pay at the counter.");
    } catch { setPaymentError("Demo price could not be loaded. You can still pay at the counter."); }
    setDemoQuote(quote);
    addTransaction({ id: pickup, kind: "Print job", title: printFiles.length > 1 ? `${printFiles.length} files` : (file?.name || "Print job"), note: `Shop ${selectedShopCode} · ${color === "bw" ? "B&W" : "Colour"} · ${copies} copy/copies`, amount: quote?.amount ?? null, date: new Date().toLocaleDateString("en-IN"), createdAt: Date.now(), paid: false, paymentMethod: null, status: "Code ready · payment not selected" });
    setPrintStage("code"); setGeneratingCode(false);
  };
  const chooseUpi = async () => {
    if (!pickup || !ownerToken || paymentBusy) return;
    setPaymentBusy(true); setPaymentError("");
    try {
      const response = await fetch(`/api/jobs/${pickup}/payment-intent`, { method: "POST", headers: { Authorization: `Bearer ${ownerToken}` }, cache: "no-store" });
      const payload = await response.json() as { error?: string; quote?: DemoQuote; payment?: PaymentSnapshot; upiUri?: string };
      if (!response.ok || !payload.payment || !payload.upiUri) throw new Error(payload.error || "Could not create the demo UPI intent.");
      setDemoQuote(payload.quote ?? null); setPaymentMethod("upi"); setPaymentStatus("pending");
      updateTransaction(pickup, { amount: payload.payment.amount, paymentMethod: "upi", paid: false, status: "UPI pending shop confirmation" });
      window.setTimeout(() => window.location.assign(payload.upiUri as string), 120);
    } catch (cause) { setPaymentError(cause instanceof Error ? cause.message : "Could not create the demo UPI intent."); }
    finally { setPaymentBusy(false); }
  };
  const chooseOffline = async () => {
    if (!pickup || !ownerToken || paymentBusy) return;
    setPaymentBusy(true); setPaymentError("");
    try {
      const response = await fetch(`/api/jobs/${pickup}/payment-choice`, { method: "POST", headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ method: "offline" }), cache: "no-store" });
      const payload = await response.json() as { error?: string; quote?: DemoQuote; payment?: PaymentSnapshot };
      if (!response.ok || !payload.payment) throw new Error(payload.error || "Could not save the demo payment choice.");
      setDemoQuote(payload.quote ?? demoQuote); setPaymentMethod("offline"); setPaymentStatus("pending");
      updateTransaction(pickup, { amount: payload.payment.amount, paymentMethod: "offline", paid: false, status: "Pay at counter · awaiting confirmation" });
    } catch (cause) { setPaymentError(cause instanceof Error ? cause.message : "Could not save the demo payment choice."); }
    finally { setPaymentBusy(false); }
  };
  const simulateShopPaymentDone = async () => {
    if (!pickup || !ownerToken || paymentBusy) return;
    setPaymentBusy(true); setPaymentError("");
    try {
      const response = await fetch(`/api/jobs/${pickup}/demo-payment-done`, { method: "POST", headers: { Authorization: `Bearer ${ownerToken}` }, cache: "no-store" });
      const payload = await response.json() as { error?: string; payment?: PaymentSnapshot };
      if (!response.ok || !payload.payment) throw new Error(payload.error || "The demo shopkeeper action could not be recorded.");
      setPaymentMethod(payload.payment.method); setPaymentStatus("paid");
      updateTransaction(pickup, { amount: payload.payment.amount, paymentMethod: payload.payment.method, paid: true, createdAt: payload.payment.confirmedAt ?? Date.now(), date: new Date(payload.payment.confirmedAt ?? Date.now()).toLocaleDateString("en-IN"), status: "Payment Done · demo" });
    } catch (cause) { setPaymentError(cause instanceof Error ? cause.message : "The demo shopkeeper action could not be recorded."); }
    finally { setPaymentBusy(false); }
  };
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard may be unavailable in preview */ } };
  const openInfo = (tab: InfoTab) => { setInfoTab(tab); setMode("info"); };
  const reset = () => { stopCamera(); clear(); setMode("home"); setPrintStage("shop"); setReceivedFile(null); setShareError(""); setReceivedCode(""); };

  const Header = () => <header className="topbar"><div className="mobile-brand"><div className="brand-mark small">Q</div><span>QwickR1</span></div><div className="topbar-context"><span className="live-dot" /> Private file handoff</div><div className="topbar-actions">{signedIn ? <button className="profile-pill" type="button" onClick={() => setMode("transactions")}><UserRound size={14} /> {profileName}</button> : <button className="sign-in-button" type="button" onClick={() => setShowSignIn(true)}><LogIn size={14} /> Device profile</button>}<button className="help-button" type="button" onClick={() => window.alert("This preview opens a non-live demo UPI intent only. No payment is collected or verified.")}><Info size={15} /> Help</button></div></header>;
  const Dropzone = ({ share = false }: { share?: boolean }) => {
    const selected = share ? shareFiles : printFiles;
    const pageCount = selected.length === 0 ? 0 : selected.some(item => item.pages === null) ? null : selected.reduce((total, item) => total + (item.pages ?? 0), 0);
    return <>
      <div className={`drop-zone ${dragging ? "dragging" : ""} ${error ? "has-error" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") input.current?.click(); }}
        onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => drop(event, share)}>
        <div className="upload-icon"><UploadCloud size={24} /></div><div className="drop-title">Drop files here</div>
        <div className="drop-sub">or <span>browse from your device</span></div>
        <div className="file-rules">PDF, JPG or PNG <span>·</span> up to 25 MB each</div>
        <input ref={input} type="file" accept={exts} multiple onChange={event => change(event, share)} hidden />
      </div>
      {error && <div className="error-message"><CircleAlert size={15} /><span>{error}</span>
        {uploadInterrupted && !share && <button className="retry-link" type="button" onClick={() => void startPrintUpload()}>Retry</button>}
        {shareUploadInterrupted && share && <button className="retry-link" type="button" onClick={() => void createShare()}>Retry</button>}
      </div>}
      {selected.length > 0 && <div className="selected-files">{selected.map((item, index) => <div className="file-card enter" key={`${item.name}-${item.size}-${index}`}>
        <div className="file-type-icon">{item.type === "application/pdf" || item.name.toLowerCase().endsWith(".pdf") ? <FileText size={20} /> : <ImageIcon size={20} />}</div>
        <div className="file-details"><strong>{item.name}</strong><span>{bytes(item.size)} · {item.pages === null ? "Page count unavailable" : `${item.pages} ${item.pages === 1 ? "page" : "pages"}`}</span></div>
        {!share && <button className="rotate-button" type="button" onClick={() => rotateSelectedFile(index)} aria-label={`Rotate ${item.name} 90 degrees`} title={`Rotation ${item.rotation}°`}>Rotate 90°</button>}
        <button className="icon-button" type="button" onClick={() => removeFileAt(index, share)} aria-label={`Remove ${item.name}`}><X size={16} /></button>
        {uploading && index === 0 && <span className="progress-number">{progress}%</span>}
      </div>)}<div className="file-total"><strong>{selected.length} file{selected.length === 1 ? "" : "s"}</strong><span>{pageCount === null ? "Page count unavailable" : `${pageCount} page${pageCount === 1 ? "" : "s"}`}</span></div></div>}
    </>;
  };
  const Rail = () => <aside className="brand-rail"><div><div className="brand-lockup"><div className="brand-mark">Q</div><div><div className="brand-name">QwickR1</div><div className="brand-kicker">PRIVATE FILE HANDOFF</div></div></div><div className="rail-shop"><div className="rail-label">ONE APP · TWO USES</div><div className="rail-shop-name">Print files or share files</div><div className="rail-shop-location"><ShieldCheck size={13} /> No account required</div></div><div className="rail-mode-list"><button type="button" className={mode === "print" ? "rail-mode active" : "rail-mode"} onClick={openPrint}><PrinterIcon /> <span><strong>Print files</strong><small>Send to a local shop</small></span></button><button type="button" className={mode === "share" ? "rail-mode active" : "rail-mode"} onClick={openShare}><Send size={17} /> <span><strong>Share files</strong><small>Device to device</small></span></button><button type="button" className={mode === "transactions" ? "rail-mode active" : "rail-mode"} onClick={() => signedIn ? setMode("transactions") : setShowSignIn(true)}><History size={17} /><span><strong>Transactions</strong><small>{signedIn ? "Your activity log" : "Optional sign in"}</small></span></button></div></div><div className="rail-footer"><LockKeyhole size={15} /><span>Temporary files. Private by default.</span></div></aside>;
  const PrinterIcon = () => <span className="rail-icon"><FileText size={17} /></span>;

  const HomeView = () => <section className="flow-screen enter home-view"><div className="eyebrow">WELCOME TO QWICKR1 <span>·</span> NO LOGIN</div><h1>What do you want to do?</h1><p className="lede">Move a file without the usual mess. Send it to a print shop or share it directly with someone nearby.</p><div className="mode-cards"><button className="mode-card print" type="button" onClick={openPrint}><div className="mode-card-icon"><FileText size={24} /></div><div><strong>Print files</strong><span>Send your files to a local shop and collect them with a short code. Then choose demo UPI or pay at the counter.</span><em>Start a print job <ArrowRight size={15} /></em></div></button><button className="mode-card share" type="button" onClick={openShare}><div className="mode-card-icon"><Send size={23} /></div><div><strong>Share files</strong><span>Send a file from your device to another device using a short code or QR.</span><em>Share a file <ArrowRight size={15} /></em></div></button></div><div className="home-note"><ShieldCheck size={17} /><div><strong>Private by design</strong><span>Short codes expire automatically. Files are retrieved only through an active code; payment status is simulated; no real payment is collected, verified, or transferred, and no public file URL is exposed.</span></div></div>{signedIn && publicRecent.length > 0 && <div className="recent-public"><div><strong>Recent activity</strong><span>Showing the last 3 logs · <button type="button" onClick={() => setShowSignIn(true)}>save a device profile</button></span></div>{publicRecent.map(tx => <div className="recent-public-row" key={tx.id}><span>{tx.kind}</span><strong>{tx.title}</strong><em>{tx.kind === "Print job" ? tx.paid ? "Paid · demo" : "Payment pending" : "File share"}</em></div>)}</div>}{<div className="mobile-home-tail"><button type="button" className="mobile-tail-card" onClick={() => signedIn ? setMode("transactions") : setShowSignIn(true)}><History size={18} /><span><strong>Track your records</strong><small>{signedIn ? "Open your full print and share history" : "See your last activity · sign in for the full log"}</small></span><ArrowRight size={16} /></button><div className="mobile-legal-links"><span>Information</span><button type="button" onClick={() => openInfo("privacy")}>Privacy</button><button type="button" onClick={() => openInfo("cookies")}>Cookies</button><button type="button" onClick={() => openInfo("terms")}>Terms</button><button type="button" onClick={() => openInfo("liability")}>Liability</button><button type="button" onClick={() => openInfo("about")}>About</button></div></div>}</section>;

  const PrintView = () => <>{printStage === "shop" && <section className="flow-screen enter"><button className="back-button" type="button" onClick={reset}><ArrowLeft size={16} /> Back to home</button><div className="eyebrow">PRINT FILES <span>·</span> STEP 01</div><h1>Choose a shop to print with.</h1><p className="lede">Scan the shop’s QwickR1 QR or enter its code, then send your files for printing.</p><div className="scanner-card"><div className="scanner-visual"><ScanLine size={45} /><span>Camera scanner</span><small>Scan a QwickR1 shop QR</small></div><div className="scanner-actions"><button className="primary-button" type="button" onClick={() => startCamera("shop")}><Camera size={17} /> Scan shop QR</button><div className="manual-shop"><input ref={shopCodeInput} placeholder="6-digit shop code" inputMode="numeric" aria-label="Shop code" /><button className="secondary-button" type="button" onClick={() => { const code = (shopCodeInput.current?.value || "").replace(/\D/g, "").slice(0, 6); if (code.length === 6) { setSelectedShopCode(code); setError(""); goUpload(); } else setError("Enter a six-digit shop code."); }}><Smartphone size={16} /> Use code</button></div></div></div><div className="info-strip"><MapPin size={16} /><span>Try demo shop code <strong>123456</strong> to preview payment options.</span></div>{error && <div className="error-message"><CircleAlert size={15} />{error}</div>}</section>}{printStage === "upload" && <section className="flow-screen enter"><button className="back-button" type="button" onClick={goBack}><ArrowLeft size={16} /> Back to shop</button><div className="eyebrow">PRINT FILES <span>·</span> STEP 02</div><h1>Send files to shop {selectedShopCode}.</h1><p className="lede">Upload the files you want printed. The shop receives them only for this job.</p><div className="upload-layout"><div><Dropzone /></div><div className="privacy-card"><div className="privacy-heading"><LockKeyhole size={17} /> Private shop handoff</div><p>Your file is linked to shop <strong>{selectedShopCode}</strong>. Access ends with the 10-minute code; files are temporary and can be removed when the print is collected.</p><div className="privacy-rule" /><div className="privacy-note"><ShieldCheck size={16} /><span>PDF, JPG and PNG · 25 MB each</span></div></div></div><div className="bottom-action"><button className="primary-button" type="button" disabled={!printFiles.length || uploading} onClick={() => void startPrintUpload()}>{uploading ? `Uploading ${progress}%` : "Continue to print settings"} <ArrowRight size={17} /></button></div></section>}{printStage === "settings" && <section className="flow-screen enter"><button className="back-button" type="button" onClick={goBack}><ArrowLeft size={16} /> Back to upload</button><div className="eyebrow">PRINT FILES <span>·</span> STEP 03</div><h1>How should we print it?</h1><p className="lede">These settings are shared with the shop before they open your file.</p><div className="settings-grid"><div className="settings-column"><div className="setting-group"><div className="setting-title">Colour mode</div><div className="segmented"><button type="button" className={color === "bw" ? "selected" : ""} onClick={() => setColor("bw")}>Black & white</button><button type="button" className={color === "colour" ? "selected color-selected" : ""} onClick={() => setColor("colour")}>Colour</button></div></div><div className="setting-group"><div className="setting-title">Number of copies</div><div className="counter-control"><button type="button" onClick={() => setCopies(Math.max(1, copies - 1))} disabled={copies === 1}><Minus size={18} /></button><strong>{copies}</strong><button type="button" onClick={() => setCopies(Math.min(10, copies + 1))}><Plus size={18} /></button></div></div><div className="setting-row"><div><div className="setting-title">Paper size</div><div className="setting-help">Supported by this shop</div></div><label className="select-wrap"><select value={paper} onChange={e => setPaper(e.target.value)}><option>A4</option><option>A3</option></select><ChevronDown size={15} /></label></div><div className="setting-row"><div><div className="setting-title">Sides</div><div className="setting-help">One or both sides</div></div><label className="select-wrap"><select value={duplex} onChange={e => setDuplex(e.target.value)}><option value="single">Single-sided</option><option value="double">Double-sided</option></select><ChevronDown size={15} /></label></div></div><div className="mini-ticket"><div className="mini-ticket-label">YOUR FILES</div><div className="mini-file"><FileText size={18} /><div><strong>{file?.name}</strong><span>{printFiles.length} file{printFiles.length === 1 ? "" : "s"} · {totalPages === null ? "page count unavailable" : `${totalPages} page${totalPages === 1 ? "" : "s"}`}</span></div></div><div className="mini-ticket-line" /><div className="mini-summary"><span>{color === "bw" ? "Black & white" : "Colour"} · {copies} copy/copies</span><span>{paper} · {duplex === "single" ? "Single" : "Double"}</span></div></div></div><div className="document-controls"><div className="setting-title">Print pages</div><div className="segmented"><button type="button" className={pageMode === "all" ? "selected" : ""} onClick={() => setPageMode("all")}>All pages</button><button type="button" className={pageMode === "custom" ? "selected" : ""} onClick={() => setPageMode("custom")}>Custom range</button></div>{pageMode === "custom" && <input className="page-range-input" value={pageRange} onChange={e => setPageRange(e.target.value.replace(/[^0-9,-]/g, ""))} placeholder="e.g. 1-4" aria-label="Custom page range" />}<div className="rotate-control"><span>{selectedPages === null ? "Page count unavailable" : `${selectedPages} selected page${selectedPages === 1 ? "" : "s"}`}</span></div>{pageMode === "custom" && !pageRangeValid && <div className="error-message"><CircleAlert size={15} />Enter a valid page range within the document.</div>}<div className="price-pill">Price confirmed at counter</div></div><label className="note-field"><span>Customer note <em>Optional</em></span><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Staple on the top-left, please" rows={3} maxLength={140} /><small>{note.length}/140</small></label>{error && <div className="error-message"><CircleAlert size={15} />{error}</div>}<div className="bottom-action"><button className="primary-button" type="button" disabled={!pageRangeValid} onClick={() => void savePrintSettings()}>Review print ticket <ArrowRight size={17} /></button></div></section>}{printStage === "review" && <section className="flow-screen enter"><button className="back-button" type="button" onClick={goBack}><ArrowLeft size={16} /> Edit settings</button><div className="eyebrow">PRINT FILES <span>·</span> STEP 04</div><h1>Review your job.</h1><p className="lede">Check your files and print settings before sending the code to the counter.</p><div className="review-ticket"><div className="review-head"><div><div className="ticket-label">PRINT TICKET</div><div className="ticket-status"><span className="status-dot" /> Ready to send</div></div><QrCode size={20} /></div><div className="review-file-list">{printFiles.map((item, index) => <div className="review-file" key={`${item.name}-${index}`}><div className="file-type-icon large">{item.type === "application/pdf" ? <FileText size={22} /> : <ImageIcon size={22} />}</div><div><strong>{item.name}</strong><span>{item.pages === null ? "Page count unavailable" : `${item.pages} page${item.pages === 1 ? "" : "s"}`} · rotation {item.rotation}°</span></div></div>)}</div><div className="review-details"><div><span>Shop</span><strong>{selectedShopCode}</strong></div><div><span>Colour</span><strong>{color === "bw" ? "Black & white" : "Colour"}</strong></div><div><span>Copies</span><strong>{copies}</strong></div><div><span>Paper</span><strong>{paper}</strong></div><div><span>Print pages</span><strong>{pageMode === "all" ? "All pages" : pageRange}</strong></div></div>{note && <div className="customer-note"><span>Customer note</span><strong>“{note}”</strong></div>}<div className="price-pill">{demoQuote?.available && demoQuote.amount !== null ? `₹${demoQuote.amount.toFixed(2)} · Demo estimate` : "Price confirmed at counter"}</div></div><div className="bottom-action"><button className="primary-button" type="button" disabled={!pickup || generatingCode} onClick={generate}>{generatingCode ? "Preparing your code…" : "Show my code"} <ArrowRight size={17} /></button></div></section>}{printStage === "code" && <section className="flow-screen code-screen enter"><div className="success-kicker"><span className="success-check"><Check size={13} /></span> Job ready</div><h1>Show this code at the counter.</h1><p className="lede">Your files are ready for the shop. The code is valid for 10 minutes.</p><div className="code-layout"><div className="code-card"><div className="code-card-top"><span>PICKUP CODE</span><QrCode size={18} /></div><div className="pickup-code">{pickup}</div><button className="copy-button" type="button" onClick={() => copy(pickup)}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy code</>}</button><div className="qr-holder"><QR value={pickup} /></div><div className="qr-caption">Or let the shop scan this QR</div></div><div className="job-side"><div className="status-card"><div className="status-card-head"><span>JOB STATUS</span><span className="live-badge"><span className="live-dot" /> Live</span></div><div className="status-main"><span className="status-pulse" /> Waiting for print collection</div><div className="status-track"><span className="done" /><span className="done" /><span className="current" /><span /></div><div className="status-ticks"><span>Files</span><span>Code</span><span>Counter</span><span>Ready</span></div></div><div className="expiry-callout">{secondsRemaining > 0 ? <><Clock3 size={16} /> Expires in <strong>{timeLabel}</strong> · show it soon</> : <button className="secondary-button renew-button" type="button" onClick={() => void renewCode()} disabled={renewing}><RefreshCw size={15} /> {renewing ? "Renewing…" : "Renew Code"}</button>}</div>{error && <div className="error-message"><CircleAlert size={15} />{error}</div>}</div></div><div className="code-summary"><div className="code-file-list">{printFiles.map((item, index) => <div key={`${item.name}-${index}`}><FileText size={16} /><strong>{item.name}</strong><span>{color === "bw" ? "B&W" : "Colour"} · {copies} copy/copies · {paper}</span></div>)}</div><span className="price-pill">{demoQuote?.available && demoQuote.amount !== null ? `₹${demoQuote.amount.toFixed(2)} · Demo estimate` : "Price confirmed at counter"}</span></div><DemoPaymentPanel quote={demoQuote} method={paymentMethod} status={paymentStatus} busy={paymentBusy} error={paymentError} onChooseUpi={() => void chooseUpi()} onChooseOffline={() => void chooseOffline()} onSimulatePaymentDone={() => void simulateShopPaymentDone()} onTrackLogs={() => signedIn ? setMode("transactions") : setShowSignIn(true)} /><div className="bottom-action"><button className="primary-button" type="button" disabled={paymentStatus !== "paid" || paymentBusy} onClick={() => void completePrint()}>I collected my print <ArrowRight size={17} /></button></div></section>}{printStage === "done" && <section className="flow-screen enter"><div className="success-kicker"><span className="success-check"><Check size={13} /></span> Completed</div><h1>Print collected.</h1><p className="lede">Thanks for using QwickR1.</p>{!signedIn ? <div className="signin-prompt"><UserRound size={20} /><div><strong>Want to track this job?</strong><span>Save this activity on this device.</span></div><button className="secondary-button" type="button" onClick={() => setShowSignIn(true)}><LogIn size={15} /> Save profile</button></div> : <div className="signin-prompt"><History size={20} /><div><strong>Your log is updated</strong><span>Open Transactions anytime to view this print job.</span></div><button className="secondary-button" type="button" onClick={() => setMode("transactions")}>View logs</button></div>}<div className="bottom-action"><button className="secondary-button" type="button" onClick={reset}>Back to home</button></div></section>}</>;

  const SignInModal = () => <div className="modal-backdrop" role="presentation" onClick={() => setShowSignIn(false)}><div className="sign-in-modal" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={e => e.stopPropagation()}><button className="modal-close" type="button" onClick={() => setShowSignIn(false)}><X size={16} /></button><div className="modal-icon"><UserRound size={22} /></div><div className="eyebrow">DEMO PROFILE · THIS DEVICE</div><h2 id="signin-title">Create a local student profile.</h2><p>Use this profile to save manual print history and logs. It stays in this browser; there is no real account or cross-device sync in this preview.</p><label className="modal-field"><span>Your name</span><input ref={nameInput} defaultValue={profileName} placeholder="e.g. Aditi" autoComplete="name" /></label><label className="modal-field"><span>Email or phone</span><input ref={contactInput} defaultValue={profileEmail} placeholder="you@example.com" autoComplete="email" /></label><button className="primary-button" type="button" onClick={signIn}><LogIn size={16} /> Save demo profile</button><small className="modal-footnote">Saved locally in this browser.</small></div></div>;
  const TransactionsView = () => (
    <section className="flow-screen enter transactions-view">
      <button className="back-button" type="button" onClick={reset}><ArrowLeft size={16} /> Back to home</button>
      <div className="transactions-head">
        <div><div className="eyebrow">YOUR ACTIVITY <span>·</span> THIS DEVICE</div><h1>Transaction log.</h1><p className="lede">Manual print entries are kept separate from QwickR1 job and share logs.</p></div>
        <button className="sign-out-button" type="button" onClick={signOut}><LogOut size={14} /> Sign out</button>
      </div>
      <div className="profile-banner"><div className="profile-avatar">{(profileName || "Q").slice(0, 1).toUpperCase()}</div><div><strong>{profileName || "QwickR1 user"}</strong><span>{profileEmail}</span></div><span className="profile-safe"><ShieldCheck size={14} /> Demo profile · this device</span></div>
      <ManualPrintHistoryPanel entries={manualPrintEntries} monthlyTotal={monthlyExpenseTotal} onAdd={addManualPrintEntry} />
      <div className="transactions-list">
        <div className="list-heading"><strong>QwickR1 job and share logs</strong><span>{transactions.length} entries</span></div>
        {transactions.length > 0 ? transactions.map(tx => (
          <div className="transaction-row" key={tx.id}>
            <div className={`transaction-icon ${tx.kind === "Share file" ? "share" : "print"}`}>{tx.kind === "Share file" ? <Send size={16} /> : <FileText size={16} />}</div>
            <div className="transaction-main"><strong>{tx.title}</strong><span>{tx.kind} · {tx.note}</span></div>
            <div className="transaction-meta"><strong>{transactionAmountLabel(tx)}</strong><span>{tx.date} · {tx.status}</span></div>
          </div>
        )) : <div className="empty-transactions"><History size={21} /><strong>No QwickR1 jobs yet</strong><span>Jobs and shares will appear here after you use a code.</span></div>}
      </div>
    </section>
  );
  const ShareView = () => <section className="flow-screen enter"><button className="back-button" type="button" onClick={reset}><ArrowLeft size={16} /> Back to home</button><div className="eyebrow">SHARE FILES <span>·</span> DEVICE TO DEVICE</div><h1>Send or receive without a login.</h1><p className="lede">Use a temporary code or QR to move a file from one device to another. Sharing is separate from printing.</p><div className="share-tabs" role="tablist"><button className={shareTab === "sending" ? "active" : ""} type="button" onClick={() => { setShareTab("sending"); setReceivedFile(null); setShareError(""); setReceivedCode(""); }}><Send size={15} /> Sending</button><button className={shareTab === "receiving" ? "active" : ""} type="button" onClick={() => { setShareTab("receiving"); setReceivedFile(null); setShareError(""); setReceivedCode(""); }}><Download size={15} /> Receiving</button></div>{shareTab === "sending" ? <div className="share-panel"><div className="share-panel-heading"><div className="share-icon"><Send size={20} /></div><div><strong>Send files</strong><span>Select one or more files, then show the code on the other device.</span></div></div><Dropzone share={true} />{shareFiles.length > 0 && !uploading && !shareCode && <div className="bottom-action"><button className="primary-button" type="button" onClick={() => void createShare()}>{shareUploadInterrupted ? "Retry upload" : "Generate share code"} <ArrowRight size={17} /></button></div>}{shareCode && <div className="share-result"><div className="code-card"><div className="code-card-top"><span>SHARE CODE</span><QrCode size={17} /></div><div className="pickup-code">{shareCode}</div><button className="copy-button" type="button" onClick={() => copy(shareCode)}><Copy size={14} /> {copied ? "Copied" : "Copy code"}</button><div className="qr-holder"><QR value={shareCode} /></div></div><div><div className="privacy-note"><ShieldCheck size={16} /><span>Private handoff · share code</span></div><div className="expiry-callout">{shareSecondsRemaining > 0 ? <><Clock3 size={16} /> Expires in <strong>{shareTimeLabel}</strong></> : <button className="secondary-button renew-button" type="button" onClick={() => void renewShareCode()} disabled={shareRenewing}><RefreshCw size={15} /> {shareRenewing ? "Renewing…" : "Renew Code"}</button>}</div>{shareError && <div className="share-error"><CircleAlert size={14} />{shareError}</div>}<button className="secondary-button" type="button" onClick={startAnotherShare}>Send another file</button></div></div>}</div> : <div className="share-panel receive-panel"><div className="share-panel-heading"><div className="share-icon"><Download size={20} /></div><div><strong>Receive a file</strong><span>Scan the sender’s QR or enter their short code.</span></div></div><div className="receive-scanner"><ScanLine size={33} /><strong>Camera scanner</strong><span>Point your camera at a QwickR1 share QR.</span><button className="secondary-button" type="button" onClick={() => startCamera("share")}><Camera size={16} /> Open camera</button></div><div className="receive-hint"><Info size={14} /><span>On another device, enter the sender’s code here. The file appears only after a valid lookup.</span></div><div className="or-divider">OR ENTER CODE</div><div className="manual-code"><input ref={receivedCodeInput} placeholder="A2B3C4" aria-label="Share code" maxLength={6} autoCapitalize="characters" /><button className="primary-button" type="button" onClick={findShare}>Find file <ArrowRight size={16} /></button></div>{receivedFile && <div className="received-result"><div className="file-type-icon"><FileText size={20} /></div><div><strong>{receivedFile.files.length} file{receivedFile.files.length === 1 ? "" : "s"} ready</strong><span>{receivedFile.files.map(item => item.name).join(", ")} · verified by code</span></div><button className="primary-button" type="button" onClick={downloadReceived} disabled={!receivedFile.files.length}><Download size={15} /> Download</button></div>}{shareError && <div className="share-error"><CircleAlert size={14} />{shareError}</div>}</div>}</section>;

  const CameraModal = () => cameraOpen ? <div className="camera-backdrop"><div className="camera-modal"><div className="camera-modal-head"><strong>Scan QR code</strong><button type="button" onClick={stopCamera}><X size={17} /></button></div><div className="camera-frame"><video ref={videoRef} autoPlay playsInline muted /><div className="camera-reticle" /></div><p>{cameraMessage}</p>{cameraPurpose === "share" && <button className="secondary-button" type="button" onClick={stopCamera}>Enter code instead</button>}</div></div> : null;
  const InfoView = () => { const content: Record<InfoTab, { title: string; body: ReactNode }> = { cookies: { title: "Cookies & local storage", body: <><p>QwickR1 uses essential browser storage for an optional device profile and recent activity previews. We do not use advertising cookies in this MVP.</p><p>You can clear this data from your browser settings. Clearing it may remove locally saved history on this device.</p></> }, terms: { title: "Terms & conditions", body: <><p>QwickR1 provides a temporary file handoff interface between customers and participating print shops. You must use files and notes lawfully, respect copyright, and verify the shop, amount, and recipient before paying.</p><p>Print quality, turnaround, refunds, and shop-side service are agreed between the customer and shop. QwickR1 is not a payment gateway and does not hold customer funds.</p></> }, privacy: { title: "Data & privacy", body: <><p>This notice is written for the India-facing MVP with reference to the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025. It is product information, not legal advice.</p><p><strong>What we collect:</strong> optional name and contact details for a device-only profile, transaction metadata, file names and print settings, temporary uploaded file bytes, and technical data needed to keep the site secure.</p><p><strong>Where data goes:</strong> profile and activity logs stay in this browser. Uploaded files are held temporarily in server memory, not exposed as public URLs. Codes expire after 10 minutes; owners may renew within a one-hour renewal window. Files are removed when a print is marked collected or when that window closes. This in-memory MVP is not durable storage.</p><p><strong>Your choices:</strong> the device profile is optional; print/share works without it. Clear this browser’s local storage to remove the saved profile and activity. A production service needs verified identity and published privacy-request workflows.</p></> }, liability: { title: "Disclaimer of liability", body: <><p>QwickR1 is not responsible for incorrect files, print quality, shop delays, shop refusal, payment disputes, UPI availability, device permissions, network failure, or loss caused by information supplied by a user or third-party shop.</p><p>This MVP does not provide financial, legal, tax, or payment advice. Nothing here limits rights that cannot legally be excluded under applicable Indian law.</p></> }, about: { title: "About QwickR1", body: <><p>QwickR1 is a private file handoff experience for print shops and device-to-device sharing.</p><p><strong>Built by 27Onestudio</strong></p></> } }; const item = content[infoTab]; return <section className="flow-screen enter info-view"><button className="back-button" type="button" onClick={() => setMode("home")}><ArrowLeft size={16} /> Back to home</button><div className="eyebrow">QWICKR1 <span>·</span> INFORMATION</div><h1>{item.title}</h1><div className="info-tabs">{(["cookies", "terms", "privacy", "liability", "about"] as InfoTab[]).map(tab => <button key={tab} type="button" className={infoTab === tab ? "active" : ""} onClick={() => setInfoTab(tab)}>{tab === "cookies" ? "Cookies" : tab === "terms" ? "Terms" : tab === "privacy" ? "Privacy" : tab === "liability" ? "Liability" : "About"}</button>)}</div><article className="policy-card">{item.body}</article></section>; };

  return <div className="app-shell"><Rail /><main className="main-stage"><Header /><div className="content-wrap">{mode === "home" ? <HomeView /> : mode === "print" ? <PrintView /> : mode === "share" ? <ShareView /> : mode === "transactions" ? (signedIn ? <TransactionsView /> : <HomeView />) : <InfoView />} {showSignIn && <SignInModal />}<CameraModal /></div><footer className="main-footer"><span>QwickR1 customer app</span><span className="footer-separator">·</span><button type="button" onClick={() => openInfo("privacy")}>Privacy</button><button type="button" onClick={() => openInfo("cookies")}>Cookies</button><button type="button" onClick={() => openInfo("terms")}>Terms</button><button type="button" onClick={() => openInfo("liability")}>Liability</button><button type="button" onClick={() => openInfo("about")}>About</button></footer></main></div>;
}
