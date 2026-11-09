---- MODULE AjoRound ----
EXTENDS Naturals, FiniteSets

CONSTANTS Payers, C, MaxCrashes, MaxReruns, MaxTries, Fixed, Reuse

K == MaxTries
Slots == 1..K
Refusals == {"QUOTA_EXCEEDED", "INSUFFICIENT_BALANCE"}
Failed == Refusals \cup {"TIMEOUT"}
Ended == {"complete", "partial"}

VARIABLES
  round,
  status,
  lastErr,
  todo,
  inv,
  cur,
  call,
  fly,
  charged,
  received,
  up,
  crashes,
  reruns,
  tries

vars == <<round, status, lastErr, todo, inv, cur, call, fly, charged, received, up, crashes, reruns, tries>>

Init ==
  /\ round = "scheduled"
  /\ status = [p \in Payers |-> "pending"]
  /\ lastErr = [p \in Payers |-> "none"]
  /\ todo = [p \in Payers |-> "wait"]
  /\ inv = [p \in Payers |-> [k \in Slots |-> "none"]]
  /\ cur = [p \in Payers |-> 0]
  /\ call = [p \in Payers |-> "idle"]
  /\ fly = [p \in Payers |-> [k \in Slots |-> 0]]
  /\ charged = [p \in Payers |-> 0]
  /\ received = 0
  /\ up = TRUE
  /\ crashes = 0
  /\ reruns = 0
  /\ tries = [p \in Payers |-> 0]

Live == up /\ round = "collecting"

Mint(p) ==
  /\ cur[p] < K
  /\ cur' = [cur EXCEPT ![p] = @ + 1]
  /\ inv' = [inv EXCEPT ![p][cur[p] + 1] = "open"]

Settle(p, k) ==
  IF inv[p][k] = "open"
  THEN /\ inv' = [inv EXCEPT ![p][k] = "settled"]
       /\ charged' = [charged EXCEPT ![p] = @ + C]
       /\ received' = received + C
  ELSE UNCHANGED <<inv, charged, received>>

Start ==
  /\ round = "scheduled"
  /\ round' = "collecting"
  /\ UNCHANGED <<status, lastErr, todo, inv, cur, call, fly, charged, received, up, crashes, reruns, tries>>

MakeInvoice(p) ==
  /\ Live
  /\ status[p] = "pending"
  /\ Mint(p)
  /\ status' = [status EXCEPT ![p] = "invoiced"]
  /\ todo' = [todo EXCEPT ![p] = "pay"]
  /\ UNCHANGED <<round, lastErr, call, fly, charged, received, up, crashes, reruns, tries>>

SendPay(p) ==
  /\ Live
  /\ status[p] = "invoiced"
  /\ todo[p] = "pay"
  /\ call[p] = "idle"
  /\ tries[p] < MaxTries
  /\ call' = [call EXCEPT ![p] = "sent"]
  /\ todo' = [todo EXCEPT ![p] = "wait"]
  /\ tries' = [tries EXCEPT ![p] = @ + 1]
  /\ UNCHANGED <<round, status, lastErr, inv, cur, fly, charged, received, up, crashes, reruns>>

WalletRefuses(p, r) ==
  /\ call[p] = "sent"
  /\ call' = [call EXCEPT ![p] = r]
  /\ UNCHANGED <<round, status, lastErr, todo, inv, cur, fly, charged, received, up, crashes, reruns, tries>>

WalletSends(p) ==
  /\ call[p] = "sent"
  /\ call' = [call EXCEPT ![p] = "routing"]
  /\ UNCHANGED <<round, status, lastErr, todo, inv, cur, fly, charged, received, up, crashes, reruns, tries>>

PaymentArrives(p) ==
  /\ call[p] = "routing"
  /\ Settle(p, cur[p])
  /\ call' = [call EXCEPT ![p] = IF inv[p][cur[p]] = "open" THEN "ok" ELSE "TIMEOUT"]
  /\ UNCHANGED <<round, status, lastErr, todo, cur, fly, up, crashes, reruns, tries>>

ReplyTimesOut(p) ==
  /\ call[p] = "routing"
  /\ call' = [call EXCEPT ![p] = "TIMEOUT"]
  /\ fly' = [fly EXCEPT ![p][cur[p]] = @ + 1]
  /\ UNCHANGED <<round, status, lastErr, todo, inv, cur, charged, received, up, crashes, reruns, tries>>

LatePaymentArrives(p, k) ==
  /\ fly[p][k] > 0
  /\ fly' = [fly EXCEPT ![p][k] = @ - 1]
  /\ Settle(p, k)
  /\ UNCHANGED <<round, status, lastErr, todo, cur, call, up, crashes, reruns, tries>>

RecordReply(p) ==
  /\ Live
  /\ call[p] \in {"ok"} \cup Failed
  /\ call' = [call EXCEPT ![p] = "idle"]
  /\ IF call[p] = "ok"
     THEN /\ status' = [status EXCEPT ![p] = "paid"]
          /\ todo' = [todo EXCEPT ![p] = "wait"]
          /\ UNCHANGED lastErr
     ELSE IF Fixed
          THEN /\ lastErr' = [lastErr EXCEPT ![p] = call[p]]
               /\ todo' = [todo EXCEPT ![p] = "lookup"]
               /\ UNCHANGED status
          ELSE /\ status' = [status EXCEPT ![p] = call[p]]
               /\ todo' = [todo EXCEPT ![p] = "wait"]
               /\ UNCHANGED lastErr
  /\ UNCHANGED <<round, inv, cur, fly, charged, received, up, crashes, reruns, tries>>

LookupInvoice(p) ==
  /\ Live
  /\ todo[p] = "lookup"
  /\ call[p] = "idle"
  /\ LET s == inv[p][cur[p]] IN
     CASE s = "settled" ->
            /\ status' = [status EXCEPT ![p] = "paid"]
            /\ todo' = [todo EXCEPT ![p] = "wait"]
            /\ UNCHANGED <<inv, cur>>
       [] s = "expired" ->
            /\ status' = [status EXCEPT ![p] =
                 IF Fixed THEN (IF lastErr[p] = "none" THEN "TIMEOUT" ELSE lastErr[p])
                 ELSE (IF @ \in Failed THEN @ ELSE "TIMEOUT")]
            /\ todo' = [todo EXCEPT ![p] = "wait"]
            /\ UNCHANGED <<inv, cur>>
       [] s = "open" /\ tries[p] < MaxTries ->
            /\ status' = [status EXCEPT ![p] = "invoiced"]
            /\ todo' = [todo EXCEPT ![p] = "pay"]
            /\ IF Reuse THEN UNCHANGED <<inv, cur>> ELSE Mint(p)
       [] OTHER -> FALSE
  /\ UNCHANGED <<round, lastErr, call, fly, charged, received, up, crashes, reruns, tries>>

InvoiceExpires(p, k) ==
  /\ inv[p][k] = "open"
  /\ inv' = [inv EXCEPT ![p][k] = "expired"]
  /\ UNCHANGED <<round, status, lastErr, todo, cur, call, fly, charged, received, up, crashes, reruns, tries>>

CoordinatorCrashes ==
  /\ up
  /\ round = "collecting"
  /\ crashes < MaxCrashes
  /\ up' = FALSE
  /\ crashes' = crashes + 1
  /\ call' = [p \in Payers |-> "idle"]
  /\ fly' = [p \in Payers |-> IF call[p] = "routing"
                              THEN [fly[p] EXCEPT ![cur[p]] = @ + 1]
                              ELSE fly[p]]
  /\ UNCHANGED <<round, status, lastErr, todo, inv, cur, charged, received, reruns, tries>>

NeedsLookup(p) == status[p] \notin {"pending", "paid"}

CoordinatorRetries ==
  /\ ~up
  /\ up' = TRUE
  /\ todo' = [p \in Payers |-> IF NeedsLookup(p) THEN "lookup" ELSE todo[p]]
  /\ UNCHANGED <<round, status, lastErr, inv, cur, call, fly, charged, received, crashes, reruns, tries>>

RoundRunsAgain ==
  /\ up
  /\ round = "partial"
  /\ reruns < MaxReruns
  /\ round' = "collecting"
  /\ reruns' = reruns + 1
  /\ todo' = [p \in Payers |-> IF NeedsLookup(p) THEN "lookup" ELSE todo[p]]
  /\ UNCHANGED <<status, lastErr, inv, cur, call, fly, charged, received, up, crashes, tries>>

AllSettled ==
  /\ \A p \in Payers : status[p] \in {"paid"} \cup Failed /\ todo[p] = "wait" /\ call[p] = "idle"

EndRound ==
  /\ Live
  /\ AllSettled
  /\ round' = IF \A p \in Payers : status[p] = "paid" THEN "complete" ELSE "partial"
  /\ UNCHANGED <<status, lastErr, todo, inv, cur, call, fly, charged, received, up, crashes, reruns, tries>>

Done ==
  /\ round \in Ended
  /\ UNCHANGED vars

Next ==
  \/ Start
  \/ \E p \in Payers : MakeInvoice(p)
  \/ \E p \in Payers : SendPay(p)
  \/ \E p \in Payers, r \in Refusals : WalletRefuses(p, r)
  \/ \E p \in Payers : WalletSends(p)
  \/ \E p \in Payers : PaymentArrives(p)
  \/ \E p \in Payers : ReplyTimesOut(p)
  \/ \E p \in Payers, k \in Slots : LatePaymentArrives(p, k)
  \/ \E p \in Payers : RecordReply(p)
  \/ \E p \in Payers : LookupInvoice(p)
  \/ \E p \in Payers, k \in Slots : InvoiceExpires(p, k)
  \/ CoordinatorCrashes
  \/ CoordinatorRetries
  \/ RoundRunsAgain
  \/ EndRound
  \/ Done

Fairness ==
  /\ WF_vars(Start)
  /\ WF_vars(EndRound)
  /\ WF_vars(CoordinatorRetries)
  /\ \A p \in Payers :
       /\ WF_vars(MakeInvoice(p))
       /\ WF_vars(SendPay(p))
       /\ WF_vars(WalletSends(p) \/ \E r \in Refusals : WalletRefuses(p, r))
       /\ WF_vars(PaymentArrives(p))
       /\ WF_vars(RecordReply(p))
       /\ WF_vars(LookupInvoice(p))
       /\ \A k \in Slots :
            /\ WF_vars(LatePaymentArrives(p, k))
            /\ WF_vars(InvoiceExpires(p, k))

Spec == Init /\ [][Next]_vars /\ Fairness

PaidFor(p) == charged[p] > 0

NoPayerChargedTwice == \A p \in Payers : charged[p] <= C

PayeeGetsAtMostThePot == received <= Cardinality(Payers) * C

CompleteMeansEveryonePaid ==
  round = "complete" => \A p \in Payers : PaidFor(p)

RecordMatchesWalletAtEnd ==
  round \in Ended => \A p \in Payers : (status[p] = "paid") <=> PaidFor(p)

RefusedMeansNoMoneyMoved ==
  \A p \in Payers : status[p] \in Refusals => ~PaidFor(p)

RoundEnds == <>[](round \in Ended)

====
