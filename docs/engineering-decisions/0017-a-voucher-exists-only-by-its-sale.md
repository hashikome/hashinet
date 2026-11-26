# ADR-0017: A voucher exists only by its sale

Status: accepted, 14 November 2026, by the owner, from the approved prototype
(`prototypes/hearth-design/prototype`). Replaces printed batches and narrows ADR-0010, 6, and ADR-0013,
4. Widened the same day: who refunds, how refunds are reported, and the fee on net sales. Point 4
narrowed on 26 November 2026, by the owner: ways to pay belong to the business, and each venue
chooses one.

## Context

Printed vouchers were stock: made in batches before anyone paid, kept in a drawer, and sold by
recording each sale by hand. A batch can be taken without paying, left unsold, or sold without the
sale being recorded, and the price is typed rather than known. A trial of Generate vouchers (make
codes, then print or hand them out) kept the stock and its problems. At a counter in Tanzania a
guest pays in cash or by mobile money to the venue's own number, and asks where to pay ("nilipie
wapi?").

## Decision

1. **A voucher is made only when it is sold.** At a counter, someone signed in to the business sells
   it; online, a guest buys it (ADR-0010). Nothing is printed or generated ahead, so there is no
   stock, no unused batch and no sale to record by hand.
2. **One sale is one voucher:** one package, one guest, one payment, one code. A group buys with a
   few quick sales. The package sets the price; nobody types one. Who sold it, what, how it was paid
   and when are recorded by the sale itself.
3. **Confirm sale means the money is in hand.** For cash, in the seller's hand; for mobile money,
   arrived at the venue's number. A sale is never undone.
4. **Where to pay is on the sale.** For mobile money the sale shows the venue's way to pay. A
   business keeps its ways to pay in Settings › Payments, entered once for every venue: each a Lipa
   namba, a mobile money number on a network, or a bank account, with its number, the name the
   payment shows and an optional label. Its owner and business managers keep the list; one is the
   default, which can't be removed while it is. Each venue reads out the way its managers chose, or
   the default; removing a way moves the venues that chose it to the default. A business with no way
   yet sells by cash only, and the API refuses a mobile money sale there. The sale keeps the way that
   was read out, so removing a way later leaves the record as it was. Counter sales by mobile money
   need no payment provider; HashiNet's own online payments (ADR-0010) are for guests who buy
   without a seller.
5. **The guest's number belongs to the sale.** For mobile money the guest's mobile money number is
   required: the number that paid is enough to find the payment again, at a refund for instance, so a
   sale takes no confirmation code. For cash their mobile number is optional. Texting the code to it
   is extra, for a business with SMS credits (ADR-0013).
6. **The voucher is handed over** by its QR code (joining the venue's WiFi), by Send (the device's
   share sheet, from which it can also be copied), or printed on a receipt printer, one voucher.
7. **A wrong sale is refunded, not undone.** An owner or a manager refunds a voucher while it is not
   used yet: the full price, recorded with how it went back (cash, or mobile money to a number with
   its reference) and an optional reason. A refunded voucher stops working. A voucher in use is not
   refunded, and none is revoked: a voucher handed over was paid for. A seller who sold the wrong
   package asks an owner or a manager.
8. **A refund is its own line, counted on the day it is made,** as point-of-sale systems report it:
   Payments lists it as a row of its own (minus the price, how it went back, who refunded it) and the
   sale's row stays as it was; takings and analytics show gross sales, refunds and net sales; the
   cash a seller hands over is their cash sales less the cash they gave back that day. A refund by
   mobile money leaves the drawer alone.
9. **Fees are on net sales, counted monthly.** HashiNet's fee (ADR-0013, 3) is worked out on each
   venue's month: the vouchers it sold, less the refunds made that month. No fee is charged on money
   given back, and the month's total is what the minimum and the lower band need anyway. A refund
   made in a later month than its sale counts in the month it was made.

## What must hold

- Making a voucher and recording its sale are one transaction; there is no way to make a voucher
  without a sale, at a counter or online.
- A counter sale with mobile money is refused without the guest's mobile money number.
- A refund is refused once the voucher has been used, is made only by an owner or a manager, and is
  recorded once.
- Every figure of sales (Payments, Today, analytics, billing) comes from one definition: sold, less
  refunded, by the day of each.
- Ways to pay are the business's own data, so the copy rule (never name the payment company) covers
  HashiNet's words, not what an owner enters.

## Evidence

- The sale model was designed and walked in the prototype at 390, 768 and 1440 wide, in light and
  dark, by the owner, then audited (design-audit, 14 November 2026).
- Refund reporting follows point-of-sale practice: Square reports gross sales, refunds and net sales
  (gross less refunds) and expects the cash drawer to hold cash sales less cash refunds; Toast takes a
  cash refund off the drawer on the day it is processed (their help centres, read 14 November 2026).
- Platforms differ on keeping a commission after a refund; those that keep it do so because the
  payment processor keeps its fee, a cost HashiNet does not have.

## Options considered

- **Printed batches** (replaced): stock that can be taken, left unsold or sold unrecorded, with a
  typed price.
- **Generate vouchers, then print or hand out** (shelved): the same stock with a different button.
- **A basket, or How many on one sale** (rejected): invites bulk selling and pushes a group onto one
  payment; quick repeated sales do the job.
- **Undo this sale** (replaced by refunds): undoing doesn't return mobile money; a refund records how
  the money went back.
- **Revoke** (rejected): it fits devices (End session), not a paid voucher.
- **A seller refunds their own sale** (rejected): refunds give money back, so they stay with an owner
  or a manager.
- **The payment's confirmation code on a mobile money sale** (not taken): the number that paid finds
  the payment when needed, and the counter stays quick.
- **A fee on each sale** (rejected): every refund would reverse a fee already charged, and the minimum
  and the lower band need the month's total regardless.
- **Fees on the original sale whatever happens to it** (rejected): HashiNet loses nothing on a refund,
  so keeping a fee on money given back has no reason.
- **A red asterisk for required fields** (not taken): forms are short and mostly required, red means a
  problem here, and the greyed main button already marks what is needed; optional fields say so in
  their label (DESIGN.md).
