# QwickR1 customer app — implementation plan

## Scope and product approach

Enhance the supplied React/TypeScript QwickR1 customer app in place. Preserve its one-page route, logo treatment, navy/cobalt/off-white palette, spacing, Manrope + IBM Plex Mono typography, and existing print/share navigation. Keep changes focused on secure multi-file handoff, document controls, code expiry, and the customer's manual print-history workflow. After review, show a highlighted code followed by online UPI and offline-at-counter choices. For this local prototype, build the UPI intent from clearly marked, non-routable demo shop data; do not collect or claim real payment. A customer-side demo control simulates the shopkeeper's future “Payment Done” event. Add a monthly expenses total and keep manually entered print records visually distinct from QwickR1 job/share logs. Retain the device-local profile as a demo only until real authentication is connected.

Reference: the user-supplied public app at https://qwickr1app-hunlbgjb.manus.space and the attached `qwickr1-customer-mvp.zip` source.

## Design

- **Movement:** restrained contemporary utility software, matching the supplied QwickR1 site.
- **Core principles:** private by default; generous, mobile-first spacing; clear staged workflow; minimal labels and useful inline errors.
- **Color philosophy:** navy for trust and structure, cobalt for primary action, white/off-white for clarity, muted mint for success. Flat fills only; no gradients.
- **Layout paradigm:** persistent brand rail on wide screens, a single focused workflow column, and stacked controls on mobile.
- **Signature elements:** compact code card; quiet dotted upload area; status/expiry pill.
- **Interaction:** accessible keyboard/touch actions, 44px minimum targets, inline validation, visible upload progress, retry without losing the current selection.
- **Animation:** preserve existing short, subtle screen-entry and hover transitions; no motion added to critical status changes.
- **Typography:** retain Manrope for interface/headings and IBM Plex Mono for codes, labels, and technical status.
- **Brand essence:** private file handoff for print customers; practical, calm, trustworthy.
- **Brand voice:** short, direct, reassuring. Examples: “Drop files here.” “Upload interrupted. Tap to Retry.”
- **Wordmark/mark:** a white outlined Q monogram in a navy rounded tile with a cobalt tail; keep the existing QwickR1 wordmark in the interface.
- **Signature color:** supplied cobalt `#2563eb`.

## Implementation

### Frontend (`client/src`)

- Retain the app's root route and current component styling.
- Add client-side extension/MIME and file-signature checks; reject files over 25 MiB with the exact requested message before network upload.
- Parse PDFs with PDF.js to detect encrypted/password-protected documents and count pages in the client; derive PDF page counts again from uploaded bytes on the server, and use only those server-derived counts to validate custom ranges. Do not trust page counts supplied by the browser. Keep images as independent image files.
- Support additive multi-file selection, per-file removal, per-file 90-degree rotation, all-pages/custom-range selection, progress, and a retry action that reuses selected files and settings.
- Upload with same-origin relative API paths. Do not create or display public file URLs.
- Use only the seeded demo shop code `123456` for estimated demo prices: A4 B&W ₹2/page, A4 colour ₹6/page, A3 B&W ₹4/page, and A3 colour ₹12/page. Use `qwickr1-demo@invalid` as a reserved, non-routable placeholder VPA; label the sample amount and destination as demo/non-live. Generate the UPI intent with shop payee, amount, INR, and the QwickR1 code as its transaction note. For other shop codes or unreliable page counts, show “Price confirmed at counter”, retain an unknown amount as unknown, and never present it as ₹0.00.
- Show a six-character code, 10-minute expiry, and “Renew Code” when expired; retain job/files/settings when renewing.
- Replace localStorage-only cross-device sharing with the same server-authorized, short-lived code flow.
- On the code screen, offer “Pay via UPI” and “Pay at counter”. Returning from UPI leaves the job pending until the simulated shopkeeper confirmation; never infer payment from link launch or app return. After the simulated payment-done event, show a path to the transaction log.
- Keep manual “Add print to history” separate from job/share records, with its own icon and color, note and price fields, and profile gating. Hide history/recent log details after sign-out and return to home on sign-out. Sum saved manual-print entries plus confirmed paid print jobs with known prices in the current month for “Total expenses this month”; do not treat unknown prices as zero.

### Backend (`server/index.ts`)

- Add multipart upload endpoints for print jobs and shares. Enforce file count limits, 25 MiB per file, approved extensions/MIME, and PDF/PNG/JPEG magic bytes server-side. Reject encrypted PDFs. Derive each printable PDF's actual page count server-side, use one page for each image, and validate custom ranges against those canonical counts rather than client-supplied values.
- Keep temporary file bytes in process memory; store generated internal file IDs only. Never serve a static/public file URL or redirect to one. Retrieval endpoints require an active job/share code and file ID, and stream bytes from the server.
- Generate codes with Node cryptographic randomness from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` only.
- Give sessions a 10-minute expiry. Permit a maximum of three renewals per session in any one-hour window; renew the same session only, without re-upload.
- Bind the entered six-digit shop code to print-job metadata. `server/demoPayment.ts` supplies non-live sample shop details/rates and builds the UPI URI from server-stored settings/page counts. Owner-authorized payment actions/status require an active 10-minute code; the one-hour renewal grace window permits renewal only, not starting or confirming payment. Record online/offline choice and the simulated “Payment Done” event; never present the placeholder VPA as a real merchant or claim money moved. Preserve unavailable counter amounts as unknown rather than zero, display “Price confirmed at counter”, and omit unpriced jobs from numeric expense totals. Real shop lookup, VPA/rates, authenticated merchant confirmation, and UPI settlement remain integration work for the user's separate shop product.
- Clean up expired in-memory sessions and cap input size. Return short, non-sensitive error messages.
- Scope note: the user-facing MVP has no durable database or object store. Process memory is temporary and is cleared by a server restart; the preview is for MVP behavior, not production-grade durable storage.

### Project structure and dependencies

- `client/src/pages/Home.tsx` — existing customer screens and workflow.
- `client/src/components/DemoPaymentPanel.tsx` — online/offline choices and clearly labelled shopkeeper confirmation simulator.
- `client/src/components/ManualPrintHistoryPanel.tsx` — separately styled manual print records and entry form.
- `server/demoPayment.ts` — demo shop fixture, server quote calculation, and UPI intent construction.
- `client/src/index.css` — existing flat, minimal visual system plus touch/validation additions.
- `server/index.ts` — API, validation, temporary sessions, renewal limits, protected retrieval.
- `shared/` — shared validation constants/types if needed.
- `client/public/manus-routes.json` — one declared app route (`/`).
- Use PDF.js for browser-side PDF reading/encrypted-file detection, `pdf-lib` for actual PDF page rotation and server-side page-count parsing, Multer for multipart uploads, and a QR renderer for share/pickup codes.

## Serving and build

Use the initialized managed Webdev project and its configured port 3000. Keep API calls root-relative for Preview proxy compatibility. Build the Vite client into `dist/public` and bundle/run the Express server on `0.0.0.0:$PORT` (default 3000). Register TypeScript diagnostics before edits. Preserve the project Git metadata and checkpoint only the intended source changes after checks; do not claim publication unless the platform confirms it.
