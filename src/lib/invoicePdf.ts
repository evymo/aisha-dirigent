import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import type { OrderInvoiceData } from "@/hooks/useOrderInvoiceData";
import type { InvoiceHeaderConfig } from "@/hooks/useInvoiceSettings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvoicePdfOptions {
  invoiceHeader: InvoiceHeaderConfig;
  order: OrderInvoiceData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number, currency = BASE_CURRENCY_FALLBACK): string {
  return new Intl.NumberFormat("cs-CZ", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

function addressToString(
  addr: Record<string, unknown> | null | undefined
): string {
  if (!addr) return "";
  const parts: string[] = [];
  if (addr.street) parts.push(String(addr.street));
  if (addr.address) parts.push(String(addr.address));
  if (addr.city || addr.postalCode) {
    const cityLine = [addr.postalCode, addr.city].filter(Boolean).join(" ");
    parts.push(cityLine);
  }
  if (addr.country) parts.push(String(addr.country));
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Invoice HTML Template
// ---------------------------------------------------------------------------

function buildInvoiceHtml({ invoiceHeader, order }: InvoicePdfOptions): string {
  const h = invoiceHeader;
  const currency = order.currency || BASE_CURRENCY_FALLBACK;
  const items = order.order_items || [];

  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${item.product_name || item.product_sku || item.product_id || "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(item.price_at_purchase, currency)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(item.price_at_purchase * item.quantity, currency)}</td>
    </tr>`
    )
    .join("\n");

  const billingAddr = addressToString(order.billing_address);
  const shippingAddr = addressToString(order.shipping_address);
  const customerAddr = billingAddr || shippingAddr;
  const customerName = order.user_name || order.user_email || "";

  const subtotal = order.subtotal ?? order.total - (order.shipping ?? 0);
  const shipping = order.shipping ?? 0;
  const tax = order.tax ?? 0;

  // Bank transfer payment details
  const showBankDetails = order.payment_method === "bank_transfer";
  const bankDetailsHtml = showBankDetails
    ? `
    <div style="margin-top:24px;padding:16px;border:1px solid #2563eb;border-radius:8px;background:#eff6ff;">
      <h3 style="margin:0 0 12px;font-size:14px;color:#1e40af;">Platební údaje / Payment Details</h3>
      <table style="width:100%;font-size:13px;">
        ${h.bank_account_iban ? `<tr><td style="padding:3px 0;color:#666;width:130px;">IBAN:</td><td style="font-family:monospace;">${formatIban(h.bank_account_iban)}</td></tr>` : ""}
        ${h.bank_account_bic ? `<tr><td style="padding:3px 0;color:#666;">BIC/SWIFT:</td><td style="font-family:monospace;">${h.bank_account_bic}</td></tr>` : ""}
        ${order.variable_symbol ? `<tr><td style="padding:3px 0;color:#666;">VS:</td><td style="font-weight:bold;font-family:monospace;">${order.variable_symbol}</td></tr>` : ""}
        <tr><td style="padding:3px 0;color:#666;">Částka / Amount:</td><td style="font-weight:bold;">${formatCurrency(order.total, currency)}</td></tr>
      </table>
    </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Faktura ${order.invoice_number || ""}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #333; line-height: 1.5; }
    @page { margin: 20mm; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body style="padding:40px;">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;">
    <div>
      <h1 style="font-size:28px;font-weight:bold;color:#111;">${h.company_name || "PLATFORM by RTN"}</h1>
      <div style="color:#666;font-size:12px;margin-top:4px;">
        ${h.address_line1 ? `<div>${h.address_line1}</div>` : ""}
        ${h.address_line2 ? `<div>${h.address_line2}</div>` : ""}
        ${h.postal_code || h.city ? `<div>${[h.postal_code, h.city].filter(Boolean).join(" ")}</div>` : ""}
        ${h.country ? `<div>${h.country}</div>` : ""}
      </div>
      <div style="color:#666;font-size:12px;margin-top:8px;">
        ${h.ico ? `<div>IČO: ${h.ico}</div>` : ""}
        ${h.dic ? `<div>DIČ: ${h.dic}</div>` : ""}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:bold;color:#2563eb;">FAKTURA</div>
      <div style="font-size:16px;font-weight:600;margin-top:4px;">${order.invoice_number || "DRAFT"}</div>
      <div style="color:#666;font-size:12px;margin-top:8px;">
        <div>Datum vystavení: ${order.invoice_generated_at ? formatDate(order.invoice_generated_at) : formatDate(order.created_at)}</div>
        <div>Datum objednávky: ${formatDate(order.created_at)}</div>
      </div>
    </div>
  </div>

  <!-- Customer -->
  <div style="margin-bottom:32px;padding:16px;background:#f9fafb;border-radius:8px;">
    <div style="font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;margin-bottom:6px;">Odběratel / Customer</div>
    <div style="font-weight:600;">${customerName}</div>
    ${order.user_email ? `<div style="color:#666;">${order.user_email}</div>` : ""}
    ${customerAddr ? `<div style="color:#666;margin-top:4px;">${customerAddr}</div>` : ""}
  </div>

  <!-- Items Table -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr style="background:#f1f5f9;">
        <th style="padding:8px;text-align:left;font-size:12px;text-transform:uppercase;color:#666;border-bottom:2px solid #e2e8f0;">Položka / Item</th>
        <th style="padding:8px;text-align:center;font-size:12px;text-transform:uppercase;color:#666;border-bottom:2px solid #e2e8f0;">Množství / Qty</th>
        <th style="padding:8px;text-align:right;font-size:12px;text-transform:uppercase;color:#666;border-bottom:2px solid #e2e8f0;">Cena/ks / Unit Price</th>
        <th style="padding:8px;text-align:right;font-size:12px;text-transform:uppercase;color:#666;border-bottom:2px solid #e2e8f0;">Celkem / Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;">
    <table style="width:280px;">
      <tr>
        <td style="padding:4px 8px;color:#666;">Mezisoučet / Subtotal:</td>
        <td style="padding:4px 8px;text-align:right;">${formatCurrency(subtotal, currency)}</td>
      </tr>
      ${shipping > 0 ? `<tr><td style="padding:4px 8px;color:#666;">Doprava / Shipping:</td><td style="padding:4px 8px;text-align:right;">${formatCurrency(shipping, currency)}</td></tr>` : ""}
      ${tax > 0 ? `<tr><td style="padding:4px 8px;color:#666;">DPH / Tax:</td><td style="padding:4px 8px;text-align:right;">${formatCurrency(tax, currency)}</td></tr>` : ""}
      <tr style="border-top:2px solid #333;">
        <td style="padding:8px;font-weight:bold;font-size:15px;">Celkem / Total:</td>
        <td style="padding:8px;text-align:right;font-weight:bold;font-size:15px;">${formatCurrency(order.total, currency)}</td>
      </tr>
    </table>
  </div>

  ${bankDetailsHtml}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;color:#999;font-size:11px;text-align:center;">
    ${h.company_name || "PLATFORM by RTN"} | ${h.ico ? `IČO: ${h.ico}` : ""} ${h.dic ? `| DIČ: ${h.dic}` : ""}
    ${h.bank_name ? `| ${h.bank_name}` : ""}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a print-ready invoice in a new window.
 * User can save as PDF via browser print dialog.
 *
 * @param options - Invoice header config + order data
 */
export function printInvoice(options: InvoicePdfOptions): void {
  const html = buildInvoiceHtml(options);
  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    throw new Error("popup_blocked");
  }

  printWindow.document.write(html);
  printWindow.document.close();

  // Wait for content to render before triggering print
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}

/**
 * Download invoice as HTML file (fallback for print issues).
 *
 * @param options - Invoice header config + order data
 */
export function downloadInvoiceHtml(options: InvoicePdfOptions): void {
  const html = buildInvoiceHtml(options);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `faktura-${options.order.invoice_number || options.order.id.slice(0, 8)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
