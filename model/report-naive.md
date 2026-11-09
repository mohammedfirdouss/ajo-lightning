# AjoRound

TLC reached 175 states and 343 steps. The chart draws 23 states and 38 arrows.
The chart does not draw 138 steps that stay in one chart state.
The view hides 31 steps, so the chart does not draw them.

## RecordMatchesWalletAtEnd breaks
The shortest path has 8 steps:
0. Scheduled / No invoice yet
1. the round opens: Collecting / No invoice yet
2. the payee's wallet makes the invoice: Collecting / Invoice ready to pay
3. the app asks the payer's wallet to pay: Collecting / Payment asked for, no reply yet
4. the wallet sends the payment: Collecting / Payment asked for, no reply yet
5. the reply times out, payment still in flight: Collecting / Reply in, not yet recorded
6. the late payment reaches the payee: Collecting / Reply in, not yet recorded, payee has the sats
7. the app records the reply: Collecting / Shown failed, timed out, payee has the sats
8. the round closes: Partial / Shown failed, timed out, payee has the sats

## RefusedMeansNoMoneyMoved breaks
The shortest path has 11 steps:
0. Scheduled / No invoice yet
1. the round opens: Collecting / No invoice yet
2. the payee's wallet makes the invoice: Collecting / Invoice ready to pay
3. the app asks the payer's wallet to pay: Collecting / Payment asked for, no reply yet
4. the wallet sends the payment: Collecting / Payment asked for, no reply yet
5. the coordinator crashes [after it asked for a payment]: Collecting / Coordinator down
6. the coordinator restarts and retries: Collecting / Checking the invoice
7. the app looks up the invoice: Collecting / Invoice ready to pay
8. the late payment reaches the payee: Collecting / Invoice ready to pay, payee has the sats
9. the app asks the payer's wallet to pay: Collecting / Payment asked for, no reply yet, payee has the sats
10. the wallet refuses, over budget or no funds: Collecting / Reply in, not yet recorded, payee has the sats
11. the app records the reply: Collecting / Shown failed, refused by the wallet, payee has the sats

## Rules that hold
NoPayerChargedTwice, PayeeGetsAtMostThePot, CompleteMeansEveryonePaid, NoDeadlock, RoundEnds
