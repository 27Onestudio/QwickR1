# QwickR1 implementation outcomes

## [x] Frontend validation, files, and print controls
- Support multiple files in one job.
- Support both documents and images: PDF, JPG, PNG.
- Show selected files as a simple list with remove option.
- Do not force images into a PDF unless the user explicitly chooses to combine them.
- Add a client-side size guard: block any file above 25 MB before upload begins.
- Show inline message: “File exceeds 25 MB limit.”
- Validate file types on the client: accept only PDF, JPG, PNG; PDF must begin with `%PDF-`; PNG must begin with `\x89PNG`; JPEG must begin with `\xFF\xD8\xFF`.
- Detect password-protected/encrypted PDFs using PDF.js or PDF reader exceptions.
- Show: “Protected PDF. Please remove password before upload.”
- If an upload fails midway, show: “Upload interrupted. Tap to Retry.” Preserve already-selected files and settings while retrying.
- Add a one-tap “Rotate 90°” control for uploaded photos/PDFs so upside-down scans can be corrected before sending.
- Add a simple “Print Pages” selector: All Pages; Custom Range, e.g. “1-4”. Automatically count total pages where technically possible, and validate ranges server-side against page counts derived from uploaded PDFs—not page counts supplied by the browser.
- For demo shop code `123456`, show a compact “₹{totalCost} · Demo estimate” using the seeded demo rates (A4 B&W ₹2/page, A4 colour ₹6/page, A3 B&W ₹4/page, A3 colour ₹12/page). For other codes or when the page count/rate is unavailable, show “Price confirmed at counter”; never imply the estimate is a real shop quote or show an unknown amount as ₹0.00.
- Keep the interface clean, spacious, and mobile-first; use short labels and minimal helper text; do not add long explanations, redundant disclaimers, or legal paragraphs to upload screens; keep terms/policy links quiet in the footer; all buttons and inputs have at least 44px touch targets; use flat professional colours only, no gradients.

## [x] Backend privacy and code lifecycle
- Validate the same approved file types and magic signatures on the server: PDF `%PDF-`, PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`.
- Do not expose public file URLs. All retrieval must be backend-authorised.
- Update the 6-character code generator to use only `23456789ABCDEFGHJKMNPQRSTUVWXYZ`; exclude confusing characters 0, O, 1, I, L.
- Keep the 10-minute session expiry.
- If the timer expires while the customer is waiting, show a one-tap “Renew Code” button.
- Renewing must extend the same job/session without requiring re-upload.
- Do not allow unlimited renewals without server-side rate limiting.
- Provide owner-authorized demo endpoints for quote, UPI intent, offline method, payment status, and simulated confirmation. Derive quote and link values from server-stored shop/settings and actual uploaded files; do not trust client-supplied prices or merchant details. Require an active 10-minute code for quote/payment/status/confirmation actions; an expired job can only be renewed during its renewal window before payment actions resume. Real settlement and authenticated shopkeeper integration remain outside this prototype.

## [x] Demo payment workflow
- Shop selection continues to support scanning a shop QR or entering its unique six-digit code.
- Preserve the sequence: choose shop, upload files, set print settings, review, generate and prominently highlight the six-character code, then offer online or offline payment.
- For “Pay via UPI”, create a `upi://pay` deep link containing the configured demo shop VPA/name, total amount, INR currency, and `QwickR1-{jobCode}` transaction note; use a placeholder VPA that is explicitly non-live.
- Offer “Pay at counter” for offline payment.
- If the customer returns from the UPI app, the payment remains pending until the simulated shopkeeper clicks “Payment Done”; only then mark the job paid and show “Track your logs”/history options.
- Simulate the shopkeeper confirmation locally for this prototype; do not connect to or replace the user's separate shopkeeper product.

## [x] Manual print history and monthly expenses
- Preserve a separate manual “Add print to history” action for manually tracked physical print copies; allow the student to attach a note and price.
- Keep manual print history visually distinct from QwickR1 job/share transaction logs, including its own icon and color so records are not confused.
- Require a student profile to save and view history; for this prototype the existing local device profile is only a simulation, saved in this browser and not a real account or cross-device sync. Signing out returns home and hides history/recent job details.
- Add “Total expenses this month”, summing saved manual-print entries and shop-confirmed paid print jobs with known prices for the current calendar month; exclude pending, unpaid, and unknown-price jobs.

## [x] QA / delivery checklist
- Provide a short test checklist covering: oversized file; wrong file type; encrypted PDF; network interruption; code expiry and renewal; multiple files/images; page-range selection.
- Clearly separate frontend, backend, and QA changes.
- Make only targeted changes to the existing app; preserve existing styling, routes, and baseline upload flow.

**Evidence:** `pnpm check` passed; all 15 Vitest tests passed; `pnpm build` succeeded. Rebuilt-server smoke tests passed for canonical PDF counts, forged client counts, owner-authorized online/offline choices, seeded price/UPI fields, pending-to-paid demo confirmation, unknown-shop fallback, and active-code enforcement using a fake clock (expired payment actions blocked; renewal preserved the same code). Preview root, health, and route manifest returned HTTP 200. Browser smoke confirmed local-profile gating, note/price validation, distinct manual-print styling, ₹24.00 monthly total, and Sign out returning home with recent/history details hidden. Paid-job/prior-month aggregation and remaining manual customer flows are explicitly unchecked in `QA-CHECKLIST.md`.
