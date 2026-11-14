# ADR-0017: A voucher exists only by its sale

Status: accepted, 14 November 2026, by the owner, from the approved prototype
(`prototypes/hearth-design/prototype`). Replaces printed batches and narrows ADR-0010, 6.

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
4. **Where to pay is on the sale.** For mobile money the sale shows the venue's payment details,
   which its owner or a manager keeps on the venue: up to three ways, each what it is paid through (a
   Lipa namba, a bank, a mobile money network), its number and the name the payment shows. Counter
   sales by mobile money need no payment provider; HashiNet's own online payments (ADR-0010) are for
   guests who buy without a seller.
5. **The guest's number belongs to the sale.** For mobile money the guest's mobile money number is
   required, to match the payment; for cash their mobile number is optional. Texting the code to it
   is extra, for a business with SMS credits (ADR-0013).
6. **The voucher is handed over** by its QR code (joining the venue's WiFi), by Send (the device's
   share sheet, from which it can also be copied), or printed on a receipt printer, one voucher.
7. **A wrong sale is refunded, not undone.** An owner or a manager refunds a voucher while it is not
   used yet: the full price, recorded with how it went back (cash, or mobile money to a number with
   its reference) and an optional reason. A refunded voucher stops working. A voucher in use is not
   refunded, and none is revoked: a voucher handed over was paid for.

## What must hold

- Making a voucher and recording its sale are one transaction; there is no way to make a voucher
  without a sale, at a counter or online.
- A counter sale with mobile money is refused without the guest's mobile money number.
- A refund is refused once the voucher has been used, and it is recorded once.
- Payment details are the venue's own data, so the copy rule (never name the payment company) covers
  HashiNet's words, not what an owner enters.

## Options considered

- **Printed batches** (replaced): stock that can be taken, left unsold or sold unrecorded, with a
  typed price.
- **Generate vouchers, then print or hand out** (shelved): the same stock with a different button.
- **A basket, or How many on one sale** (rejected): invites bulk selling and pushes a group onto one
  payment; quick repeated sales do the job.
- **Undo this sale** (replaced by refunds): undoing doesn't return mobile money; a refund records how
  the money went back.
- **Revoke** (rejected): it fits devices (End session), not a paid voucher.
- **A red asterisk for required fields** (not taken): forms are short and mostly required, red means a
  problem here, and the greyed main button already marks what is needed; optional fields say so in
  their label (DESIGN.md).

## Open

- Whether the seller may refund their own sale the same day, or only an owner or manager.
- How a refund shows in Payments and the day's takings, and whether it comes off the cash to hand
  over.
- Whether a mobile money sale also takes the payment's confirmation code, which ties it to one payment
  where a number may have paid twice.
- Whether fees are counted on each sold voucher's price, since a voucher now exists only once paid.
