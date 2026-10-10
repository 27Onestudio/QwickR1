import { useState } from "react";
import { Plus, Printer, X } from "lucide-react";

export type ManualPrintEntry = {
  id: string;
  note: string;
  amount: number;
  createdAt: number;
};

type ManualPrintHistoryPanelProps = {
  entries: ManualPrintEntry[];
  monthlyTotal: number;
  onAdd: (note: string, amount: number) => void;
};

function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function ManualPrintHistoryPanel({ entries, monthlyTotal, onAdd }: ManualPrintHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const save = () => {
    if (!note.trim()) {
      setError("Add a note for this manual print.");
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
      setError("Enter a price greater than ₹0 and no more than ₹10,00,000.");
      return;
    }
    onAdd(note.trim().slice(0, 140), Math.round(value * 100) / 100);
    setNote("");
    setAmount("");
    setError("");
    setOpen(false);
  };

  return (
    <>
      <section className="manual-history-panel" aria-labelledby="manual-history-title">
        <div className="manual-history-heading">
          <div className="manual-history-heading-icon"><Printer size={17} /></div>
          <div>
            <h2 id="manual-history-title">Manual print history</h2>
            <span>For print copies you add yourself, separate from QwickR1 job logs.</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
            <Plus size={15} /> Add print to history
          </button>
        </div>

        <div className="monthly-expense-card">
          <div><span>This month</span><strong>Total expenses this month</strong></div>
          <strong className="monthly-expense-amount">{formatRupees(monthlyTotal)}</strong>
        </div>

        <div className="manual-history-list">
          <div className="list-heading">
            <strong>Manually added prints</strong>
            <span>{entries.length} entries</span>
          </div>
          {entries.length === 0 ? (
            <div className="manual-history-empty">No manual prints saved yet.</div>
          ) : entries.map(entry => (
            <div className="manual-history-row" key={entry.id}>
              <div className="manual-history-icon"><Printer size={16} /></div>
              <div className="manual-history-main">
                <strong>{entry.note || "Print copy"}</strong>
                <span>Added manually · {formatDate(entry.createdAt)}</span>
              </div>
              <strong className="manual-history-amount">{formatRupees(entry.amount)}</strong>
            </div>
          ))}
        </div>
      </section>

      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="sign-in-modal manual-history-modal" role="dialog" aria-modal="true" aria-labelledby="manual-entry-title" onClick={event => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button>
            <div className="modal-icon manual-history-modal-icon"><Printer size={21} /></div>
            <div className="eyebrow">MANUAL PRINT RECORD</div>
            <h2 id="manual-entry-title">Add print to history.</h2>
            <p>This is a personal record; QwickR1 cannot automatically track physical copies.</p>
            <label className="modal-field">
              <span>Note</span>
              <input value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Biology notes, 12 pages" maxLength={140} />
            </label>
            <label className="modal-field">
              <span>Price paid (₹)</span>
              <input type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="e.g. 24" />
            </label>
            {error && <div className="error-message">{error}</div>}
            <button className="primary-button" type="button" onClick={save}>Save manual print</button>
          </div>
        </div>
      )}
    </>
  );
}
