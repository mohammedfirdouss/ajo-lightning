const roundLabel = (v) => {
  return { scheduled: "Scheduled", collecting: "Collecting", complete: "Complete", partial: "Partial" }[v.round];
};

const reasonWords = {
  QUOTA_EXCEEDED: "refused by the wallet",
  INSUFFICIENT_BALANCE: "refused by the wallet",
  TIMEOUT: "timed out",
};

const contribution = (v, p) => {
  const st = v.status[p];
  const call = v.call[p];
  const got = v.charged[p] > 0;
  let label;
  if (!v.up) label = "Coordinator down";
  else if (st === "pending") label = "No invoice yet";
  else if (st === "paid") label = "Shown paid";
  else if (st in reasonWords) label = `Shown failed, ${reasonWords[st]}`;
  else if (call === "sent" || call === "routing") label = "Payment asked for, no reply yet";
  else if (call !== "idle") label = "Reply in, not yet recorded";
  else if (v.todo[p] === "lookup")
    label = v.inv[p][v.cur[p]] === "expired" ? "Checking the invoice, it has expired" : "Checking the invoice";
  else label = "Invoice ready to pay";
  if (got && st !== "paid") label += ", payee has the sats";
  return label;
};

const payers = (v) => Object.keys(v.status).sort();

export const title = "Ajo round on Lightning";

export const state = (v) => {
  const ps = payers(v);
  if (ps.length === 1) return [roundLabel(v), contribution(v, ps[0])];
  const regions = { Round: roundLabel(v) };
  for (const p of ps) regions[`Payer ${p}`] = contribution(v, p);
  return regions;
};

export const group = (v) => {
  const ps = payers(v);
  const mismatch = ps.some((p) => (v.charged[p] > 0) !== (v.status[p] === "paid"));
  if (v.round === "complete" || v.round === "partial") return mismatch ? "wrong" : "ended";
  return "open";
};

export const colors = { open: "blue", ended: "teal", wrong: "orange" };

const hideRerun = process.env.HIDE_RERUN === "1";

export const step = (action, from, to) => {
  switch (action) {
    case "Start":
      return "the round opens";
    case "MakeInvoice":
      return "the payee's wallet makes the invoice";
    case "SendPay":
      return "the app asks the payer's wallet to pay";
    case "WalletRefuses":
      return "the wallet refuses, over budget or no funds";
    case "WalletSends":
      return "the wallet sends the payment";
    case "PaymentArrives":
      return "the payment reaches the payee and the reply comes back";
    case "ReplyTimesOut":
      return "the reply times out, payment still in flight";
    case "LatePaymentArrives":
      return "the late payment reaches the payee";
    case "RecordReply":
      return "the app records the reply";
    case "LookupInvoice":
      return "the app looks up the invoice";
    case "InvoiceExpires":
      return "the invoice expires";
    case "CoordinatorCrashes":
      return hideRerun && !payers(from).some((p) => ["sent", "routing"].includes(from.call[p]))
        ? null
        : "the coordinator crashes [after it asked for a payment]";
    case "CoordinatorRetries":
      return hideRerun && !payers(to).some((p) => to.todo[p] === "lookup" && to.status[p] === "invoiced")
        ? null
        : "the coordinator restarts and retries";
    case "RoundRunsAgain":
      return hideRerun ? null : "someone runs the round again";
    case "EndRound":
      return "the round closes";
    default:
      return action;
  }
};
