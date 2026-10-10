export type DemoShop = {
  code: string;
  name: string;
  vpa: string;
  rates: Record<"A4" | "A3", Record<"bw" | "colour", number>>;
};

export const DEMO_SHOP: DemoShop = {
  code: "123456",
  name: "QwickR1 Demo Print Shop",
  // Reserved .invalid domain: this placeholder cannot receive a real UPI payment.
  vpa: "qwickr1-demo@invalid",
  rates: {
    A4: { bw: 2, colour: 6 },
    A3: { bw: 4, colour: 12 },
  },
};

export type DemoQuote = {
  demo: true;
  available: boolean;
  shopCode: string;
  shopName: string | null;
  vpa: string | null;
  amount: number | null;
  currency: "INR";
};

type QuoteInput = {
  shopCode: unknown;
  files: Array<{ pages: number | null }>;
  pageMode: unknown;
  pageRange: unknown;
  color: unknown;
  paper: unknown;
  copies: unknown;
};

function countRange(range: unknown, totalPages: number): number | null {
  if (typeof range !== "string" || !range.trim() || range.length > 128) return null;
  let count = 0;
  for (const part of range.trim().split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > totalPages) return null;
    count += last - first + 1;
    if (count > 50_000) return null;
  }
  return count;
}

export function quoteDemoJob(input: QuoteInput): DemoQuote {
  const shopCode = typeof input.shopCode === "string" ? input.shopCode : "";
  const shop = shopCode === DEMO_SHOP.code ? DEMO_SHOP : null;
  if (!shop) return { demo: true, available: false, shopCode, shopName: null, vpa: null, amount: null, currency: "INR" };

  const totalPages = input.files.reduce((total, file) => total + (file.pages ?? 0), 0);
  const pages = input.pageMode === "custom"
    ? countRange(input.pageRange, totalPages)
    : input.pageMode === "all" ? totalPages : null;
  const copies = Number(input.copies);
  const color = input.color === "colour" ? "colour" : input.color === "bw" ? "bw" : null;
  const paper = input.paper === "A4" || input.paper === "A3" ? input.paper : null;
  if (!pages || !Number.isInteger(copies) || copies < 1 || copies > 99 || !color || !paper) {
    return { demo: true, available: false, shopCode, shopName: shop.name, vpa: shop.vpa, amount: null, currency: "INR" };
  }

  const amount = Math.round(pages * copies * shop.rates[paper][color] * 100) / 100;
  return { demo: true, available: true, shopCode, shopName: shop.name, vpa: shop.vpa, amount, currency: "INR" };
}

export function buildDemoUpiUri(jobCode: string, quote: DemoQuote): string {
  if (!quote.available || quote.amount === null || !quote.shopName || !quote.vpa) {
    throw new Error("Demo payment details are not available for this shop.");
  }
  if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(jobCode)) {
    throw new Error("Invalid QwickR1 job code.");
  }
  const amount = quote.amount.toFixed(2);
  return `upi://pay?pa=${encodeURIComponent(quote.vpa)}&pn=${encodeURIComponent(quote.shopName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(`QwickR1-${jobCode}`)}`;
}
