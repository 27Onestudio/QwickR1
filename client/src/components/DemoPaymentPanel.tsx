import { Banknote, Check, CircleAlert, ExternalLink, Smartphone } from "lucide-react";

export type DemoPaymentMethod = "upi" | "offline";
export type DemoPaymentStatus = "unselected" | "pending" | "paid";

export type DemoQuote = {
  demo: true;
  available: boolean;
  shopCode: string;
  shopName: string | null;
  vpa: string | null;
  amount: number | null;
  currency: "INR";
};

type DemoPaymentPanelProps = {
  quote: DemoQuote | null;
  method: DemoPaymentMethod | null;
  status: DemoPaymentStatus;
  busy: boolean;
  error: string;
  onChooseUpi: () => void;
  onChooseOffline: () => void;
  onSimulatePaymentDone: () => void;
  onTrackLogs: () => void;
};

function rupees(amount: number | null) {
  return amount === null ? "Confirm at counter" : `₹${amount.toFixed(2)}`;
}

export function DemoPaymentPanel({
  quote,
  method,
  status,
  busy,
  error,
  onChooseUpi,
  onChooseOffline,
  onSimulatePaymentDone,
  onTrackLogs,
}: DemoPaymentPanelProps) {
  return (
    <section className="demo-payment-card" aria-label="Payment options">
      <div className="demo-payment-heading">
        <div>
          <strong>How would you like to pay?</strong>
          <span>Choose online or pay at the counter.</span>
        </div>
        <span className="demo-only-badge">DEMO</span>
      </div>

      <div className="demo-payment-total">
        <span>{quote?.shopName ?? "Shop price"}</span>
        <strong>{rupees(quote?.amount ?? null)}</strong>
      </div>

      <p className="demo-payment-note">
        This preview uses a non-routable demo UPI address. No real payment is sent or verified.
      </p>

      {status === "unselected" && (
        <div className="demo-payment-actions">
          <button className="primary-button" type="button" onClick={onChooseUpi} disabled={busy || !quote?.available}>
            <Smartphone size={16} /> {busy ? "Preparing UPI…" : "Pay via UPI"}
          </button>
          <button className="secondary-button" type="button" onClick={onChooseOffline} disabled={busy}>
            <Banknote size={16} /> Pay at counter
          </button>
        </div>
      )}

      {status === "pending" && (
        <div className="payment-return" role="status" aria-live="polite">
          <div className="payment-pending-mark"><CircleAlert size={16} /></div>
          <div>
            <strong>{method === "upi" ? "Waiting for shop confirmation" : "Pay at the counter"}</strong>
            <span>
              {method === "upi"
                ? "Returning from the UPI app does not confirm payment. This demo stays pending until the shop action below."
                : "This demo stays pending until the shop action below confirms payment."}
            </span>
            {method === "upi" && quote?.vpa && <small>Demo destination: {quote.vpa}</small>}
          </div>
          <div className="shop-confirm-demo">
            <span>Simulated shopkeeper action</span>
            <button className="secondary-button" type="button" onClick={onSimulatePaymentDone} disabled={busy}>
              <Check size={15} /> {busy ? "Updating…" : "Payment Done"}
            </button>
          </div>
        </div>
      )}

      {status === "paid" && (
        <div className="payment-confirmed-demo" role="status" aria-live="polite">
          <div className="payment-pending-mark"><Check size={16} /></div>
          <div>
            <strong>Payment marked done · demo</strong>
            <span>No real transfer was made. The simulated confirmation is now in your job log.</span>
          </div>
          <button className="secondary-button" type="button" onClick={onTrackLogs}>
            Track your logs <ExternalLink size={14} />
          </button>
        </div>
      )}

      {error && <div className="error-message"><CircleAlert size={15} /><span>{error}</span></div>}
    </section>
  );
}
