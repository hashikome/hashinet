import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type {
  BillingSettingsRecord,
  FeeTerms,
  InvoiceLineRecord,
  InvoiceResponse,
  InvoiceState,
} from "@hashinet/types";
import PDFDocument from "pdfkit";
import { businessDayOf } from "../../core/time/business-day.js";
import { invoiceSubject, longDay, tsh } from "./invoice-emails.js";

/**
 * An invoice as a PDF (prototype `invoice.html`, approved 26 November 2026): one A4 page, black on
 * white, in Figtree, embedded, never a system font. What was charged, what came in, what is left,
 * and how to pay while anything is due. The words are the API's here, as an email's are.
 */

const require = createRequire(import.meta.url);
// WOFF, not WOFF2: the PDF library's font subsetting breaks on WOFF2's composite glyphs (é).
const font = (weight: number) =>
  readFileSync(require.resolve(`@fontsource/figtree/files/figtree-latin-${weight}-normal.woff`));
const FONTS = { regular: font(400), medium: font(500), semibold: font(600), bold: font(700) };

const INK = "#0d1b2a";
const MUTED = "#5b6b7c";
const LINE = "#d7dde4";
const EMBER = "#f59e2a";
const STATE: Record<InvoiceState, [string, string]> = {
  due: ["Due", "#8a5a00"],
  part_paid: ["Part paid", "#8a5a00"],
  paid: ["Paid", "#1f7a4d"],
  overdue: ["Overdue", "#b42318"],
  cancelled: ["Cancelled", "#5b6470"],
};
const METHOD: Record<string, string> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
  cash: "Cash",
};

const percent = (bp: number) => `${bp / 100}%`;

/** How a line's amount came about, as the owner reads it. */
function lineDetail(l: InvoiceLineRecord, terms: FeeTerms): string {
  if (l.onboardingKind) return l.label;
  const sales = `${tsh(l.netSalesTsh ?? 0)} in sales`;
  if (l.minimumTsh !== null) {
    const part = l.servedBp !== null && l.servedBp < 10_000;
    return `${sales}, ${tsh(l.minimumTsh)} monthly minimum${part ? `, for the ${Math.round((l.servedBp ?? 0) / 100)}% of the month it was served` : ""}`;
  }
  return (l.netSalesTsh ?? 0) > terms.lowerRateAboveTsh
    ? `${sales} at ${percent(terms.rateBp)}, ${percent(terms.lowerRateBp)} above ${tsh(terms.lowerRateAboveTsh)}`
    : `${sales} at ${percent(terms.rateBp)}`;
}

const LINE_NAME: Record<string, string> = {
  onboarding_fee: "Onboarding fee",
  mikrotik_router: "MikroTik router",
  isp_router: "Internet router",
  internet_line: "Internet line",
  other: "Other",
};

/** The invoice's PDF, as bytes. */
export function invoicePdf(
  { invoice, business, owner, terms, payTo }: InvoiceResponse,
  settings: BillingSettingsRecord,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 48, bottom: 40, left: 52, right: 52 },
    info: { Title: `Invoice ${invoice.number}`, Author: payTo.accountName },
  });
  for (const [name, data] of Object.entries(FONTS)) doc.registerFont(name, data);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const rule = (y: number, color = LINE, w = 0.75) =>
    doc.moveTo(left, y).lineTo(right, y).lineWidth(w).strokeColor(color).stroke();

  // The mark and the name; who issues it, under them.
  doc.save().translate(left, 48).scale(0.75);
  doc
    .path("M22.6 6.2A12 12 0 1 0 27.8 14")
    .lineWidth(2.4)
    .lineCap("round")
    .strokeColor(INK)
    .stroke();
  doc.circle(26.4, 8.4, 2).fillColor(EMBER).fill();
  doc.restore();
  doc
    .font("bold")
    .fontSize(14)
    .fillColor(INK)
    .text("HashiNet", left + 30, 52);
  const issuer = settings.issuer;
  const from = [
    payTo.accountName,
    issuer.postal,
    issuer.office,
    issuer.email,
    issuer.registration ? `Incorporation No. ${issuer.registration}` : null,
    issuer.tin ? `TIN ${issuer.tin}` : null,
  ].filter((x): x is string => x !== null);
  doc
    .font("regular")
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(from.join("\n"), left, 78, {
      width: width / 2,
      lineGap: 2,
    });
  const fromEnd = doc.y;

  // Invoice, its number, what it is for, and its state.
  doc.font("bold").fontSize(22).fillColor(INK).text("Invoice", left, 46, { width, align: "right" });
  doc.font("semibold").fontSize(11).text(invoice.number, left, 76, { width, align: "right" });
  doc
    .font("regular")
    .fontSize(10)
    .text(invoiceSubject(invoice).replace(/^HashiNet's fees for (.*)$/, "$1 fees"), {
      width,
      align: "right",
    });
  const [stateLabel, stateColor] = STATE[invoice.state];
  doc.font(invoice.state === "overdue" ? "bold" : "semibold").fontSize(8.5);
  const pillW = doc.widthOfString(stateLabel) + 14;
  const pillY = doc.y + 6;
  // Overdue reads without colour too: filled, and heavier.
  if (invoice.state === "overdue") {
    doc
      .roundedRect(right - pillW, pillY, pillW, 16, 8)
      .fillColor(stateColor)
      .fill();
    doc.fillColor("#ffffff");
  } else {
    doc
      .roundedRect(right - pillW, pillY, pillW, 16, 8)
      .lineWidth(0.9)
      .strokeColor(stateColor)
      .stroke();
    doc.fillColor(stateColor);
  }
  doc.text(stateLabel, right - pillW, pillY + 4, { width: pillW, align: "center" });

  // Billed to, issued, due.
  let y = Math.max(fromEnd, pillY + 16) + 18;
  rule(y);
  y += 14;
  const col = (x: number, label: string, lines: string[], bold = false) => {
    doc.font("regular").fontSize(8).fillColor(MUTED).text(label, x, y);
    lines.forEach((t, i) => {
      doc
        .font(bold && i === 0 ? "semibold" : "regular")
        .fontSize(10)
        .fillColor(INK)
        .text(t, x, y + 13 + i * 14, { width: width * 0.42 });
    });
  };
  const billed = [
    business.name,
    `${business.area}, ${business.region}`,
    ...(owner ? [owner.name, owner.email] : []),
  ];
  col(left, "Billed to", billed, true);
  col(left + width * 0.45, "Issued", [longDay(businessDayOf(new Date(invoice.issuedAt)))]);
  col(left + width * 0.72, "Due", [longDay(invoice.dueOn)]);
  y += 13 + billed.length * 14 + 12;
  rule(y);

  // The lines, what came in, and what is left.
  y += 18;
  doc.font("regular").fontSize(8).fillColor(MUTED);
  doc.text(invoice.kind === "monthly_fees" ? "Venue" : "Item", left, y);
  doc.text("Amount", left, y, { width, align: "right" });
  y += 14;
  rule(y);
  const amountW = 110;
  const row = (title: string, sub: string, amount: string, weight = "regular", size = 10) => {
    const top = y + 9;
    doc
      .font(weight)
      .fontSize(size)
      .fillColor(INK)
      .text(title, left, top, { width: width - amountW });
    doc.text(amount, right - amountW, top, { width: amountW, align: "right" });
    let end = top + size + 3;
    if (sub) {
      doc
        .font("regular")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(sub, left, end, { width: width - amountW });
      end = doc.y;
    }
    y = end + 8;
  };
  for (const l of invoice.lines) {
    row(
      l.onboardingKind
        ? (LINE_NAME[l.onboardingKind] ?? l.label)
        : invoice.kind === "site_slot"
          ? "Extra site, once"
          : l.label,
      invoice.kind === "site_slot" ? `${l.label}, open before guests pay` : lineDetail(l, terms),
      tsh(l.amountTsh),
    );
    rule(y);
  }
  row("Total", "", tsh(invoice.totalTsh), "semibold");
  for (const p of invoice.payments) {
    row(
      `Paid ${longDay(p.receivedOn)}`,
      [METHOD[p.method] ?? p.method, p.reference].filter(Boolean).join(" · "),
      `−${tsh(p.amountTsh)}`,
    );
  }
  rule(y, INK, 1);
  row("Amount due", "", tsh(invoice.dueTsh), "bold", 12);

  // How to pay, while anything is due: each detail on its own labelled line, bank first.
  const ways: [string, [string, string | null][]][] = [];
  if (payTo.bankAccount) {
    ways.push([
      "Bank transfer",
      [
        ["Account name", payTo.accountName],
        ["Bank", payTo.bankName],
        ["Branch", payTo.bankBranch],
        ["Account number", payTo.bankAccount],
        ["SWIFT code", payTo.bankSwift],
        ["Currency", "TZS"],
      ],
    ]);
  }
  if (payTo.mobileMoney) {
    ways.push([
      "Mobile money",
      [
        ["Lipa namba", payTo.mobileMoney],
        ["Name", payTo.mobileMoneyName],
      ],
    ]);
  }
  if (invoice.dueTsh > 0) {
    y += 16;
    doc.font("semibold").fontSize(12).fillColor(INK).text("How to pay", left, y);
    const when =
      invoice.state === "overdue"
        ? `now: it was due on ${longDay(invoice.dueOn)}`
        : `by ${longDay(invoice.dueOn)}`;
    doc
      .font("regular")
      .fontSize(10)
      .text(`Pay ${tsh(invoice.dueTsh)} ${when}, with `, left, doc.y + 4, {
        continued: true,
        width,
      })
      .font("semibold")
      .text(invoice.number, { continued: true })
      .font("regular")
      .text(" as the reference. A payment settles the oldest invoice first.");
    y = doc.y + 12;
    if (ways.length === 0) {
      doc.fillColor(MUTED).text(`Contact ${payTo.accountName} for how to pay.`, left, y, { width });
    }
    const colW = width / 2 - 12;
    let bottom = y;
    ways.forEach(([title, details], i) => {
      const x = left + i * (width / 2 + 12);
      doc.font("semibold").fontSize(10).fillColor(INK).text(title, x, y);
      let dy = y + 17;
      for (const [label, value] of details) {
        if (!value) continue;
        doc.font("regular").fontSize(9.5).fillColor(MUTED).text(label, x, dy, { width: 92 });
        doc.fillColor(INK).text(value, x + 96, dy, { width: colW - 96 });
        dy = doc.y + 3;
      }
      if (title === "Mobile money") {
        doc
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(
            "Choose Lipa kwa simu (pay by Lipa namba) in your mobile money or bank app.",
            x,
            dy + 3,
            {
              width: colW,
            },
          );
        dy = doc.y;
      }
      bottom = Math.max(bottom, dy);
    });
    y = bottom;
  }

  // A month's fees say how they were worked out: the business's own terms.
  if (invoice.kind === "monthly_fees") {
    const footY = doc.page.height - doc.page.margins.bottom - 30;
    rule(footY);
    doc
      .font("regular")
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Fees are ${percent(terms.rateBp)} of each voucher's price, ${percent(terms.lowerRateBp)} on a venue's monthly sales above ${tsh(terms.lowerRateAboveTsh)}, with a minimum of ${tsh(terms.minimumTsh)} a month per serving venue, prorated for the days a router served it.`,
        left,
        footY + 9,
        { width, lineBreak: true },
      );
  }
  doc.end();
  return done;
}
