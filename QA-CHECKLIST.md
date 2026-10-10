# QwickR1 Customer App — QA Checklist

## Automated and service checks executed

- [x] `pnpm check` — TypeScript diagnostics pass.

- [x] `pnpm exec vitest run` — 15 tests pass, covering bounded page ranges, 25 MB client guard, unsupported type/signature, encrypted-PDF message handling, and real PDF page rotation.

- [x] `pnpm build` — production frontend and backend bundle succeeds; legacy PDF.js worker is included.

- [x] API smoke checks — health/route manifest, six-character alphabet, shop-code/settings binding, private retrieval, owner authorization, invalid range, forged client page-count rejection, actual server-derived PDF counts, expired same-session renewal, renewal limit, unsupported type/signature, encrypted-PDF rejection, 25 MB server limit, multi-file share, share renewal, deletion, seeded quote, UPI intent fields, offline choice, pending-to-paid demo confirmation, unknown-shop fallback, and fake-clock rejection of expired quote/UPI/offline/confirmation actions until same-code renewal.

- [x] Preview — root, API health, and `/manus-routes.json` return HTTP 200 from the Preview origin.

- [x] PDF.js parser — a real password-protected PDF fixture raised `PasswordException` in the legacy parser.

## Manual customer-flow checklist

- [ ] **Oversized file:** choose a file larger than 25 MB; upload is blocked before transfer and displays `File exceeds 25 MB limit.`

- [ ] **Wrong file type/signature:** choose an unsupported extension or mismatched PDF/JPG/PNG bytes; upload is rejected with a concise error.

- [ ] **Encrypted PDF:** choose a password-protected PDF; it displays `Protected PDF. Please remove password before upload.`

- [ ] **Interrupted upload:** disable the network mid-upload; `Upload interrupted. Tap to Retry.` appears. Tap Retry and confirm selected files and print settings remain selected.

- [ ] **Code expiry/renewal:** wait until the 10-minute code expires; tap `Renew Code`. Confirm the same uploaded job remains available without re-upload. Verify repeated renewals are rate-limited.

- [ ] **Multiple files/images:** add multiple PDFs and images, remove one item, and confirm each remaining image stays an image and is listed separately.

- [ ] **Page-range selection:** verify `All Pages`, a valid range such as `1-4`, and invalid/out-of-bounds ranges; check true PDF page counts when readable.

- [ ] **Demo UPI intent:** after code generation, choose `Pay via UPI`; verify the generated URI has `pa`, `pn`, `am`, `cu=INR`, and `tn=QwickR1-{jobCode}`, and that the non-live demo warning is visible.

- [ ] **Payment confirmation:** choose UPI or pay at counter; returning from UPI alone must leave the job pending. Use the clearly labeled demo shopkeeper action to mark `Payment Done`, then verify the record becomes paid and `Track your logs` opens the history.

- [x] **Manual print history:** create a student device profile, add a manual print with note and price, and verify its icon/color remains distinct from QwickR1 print jobs and file shares.

- [x] **Sign-out access:** from the saved demo profile, select `Sign out`; confirm it returns home, hides the job/manual history, and changes the history entry point to `Optional sign in`.

- [ ] **Expired payment action:** after the code expires, UPI, counter, and demo-confirmation actions must remain blocked until the same job is renewed.

- [ ] **Unknown price:** use a shop code without demo rates and pay at counter; confirm no `₹0.00` is shown and the unpriced job is excluded from the numeric monthly total.

- [ ] **Monthly expenses:** verify the total includes current-month manual print entries and shop-confirmed paid jobs, but not pending/unpaid jobs or prior-month entries.
- Partial verification: a local ₹24 manual-print entry displayed a ₹24.00 total; paid-job and prior-month filtering remain to be exercised in the browser.

## Scope notes

- Print-job/share bytes are temporary in-memory data, not durable storage; files can be removed on collection or when the renewal window closes.

- Only demo code `123456` has seeded rates (A4 B&W ₹2/page, A4 colour ₹6/page, A3 B&W ₹4/page, A3 colour ₹12/page); other codes have no configured rates and show “Price confirmed at counter”. This is not a trusted real-shop directory.


## Demo payment and data scope

- Seeded demo shop code `123456` uses A4 B&W ₹2/page, A4 colour ₹6/page, A3 B&W ₹4/page, and A3 colour ₹12/page.
- `qwickr1-demo@invalid` is a reserved, non-routable placeholder VPA. The site does not collect, verify, or transfer real payments.
- Manual print history and profile data are stored only in this browser; connect the user's real identity/shopkeeper products in a later integration.
