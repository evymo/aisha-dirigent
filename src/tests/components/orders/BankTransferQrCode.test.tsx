import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BankTransferQrCode } from "@/components/orders/BankTransferQrCode";
import { generateSpdString } from "@/lib/payments/spdQrCode";
import type { BankTransferQrData } from "@/lib/payments/spdQrCode";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// ---------------------------------------------------------------------------
// generateSpdString — pure function tests
// ---------------------------------------------------------------------------

describe("generateSpdString", () => {
  it("generates basic SPD string with IBAN and amount", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 1500,
    });

    expect(result).toBe(
      "SPD*1.0*ACC:CZ6508000000192000145399*AM:1500.00*CC:CZK"
    );
  });

  it("includes BIC when provided", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 1500,
      bic: "KOMBCZPP",
    });

    expect(result).toContain("ACC:CZ6508000000192000145399+KOMBCZPP");
  });

  it("includes variable symbol when provided", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 750.5,
      variableSymbol: "1234567890",
    });

    expect(result).toContain("X-VS:1234567890");
    expect(result).toContain("AM:750.50");
  });

  it("includes message when provided", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
      message: "Platba za obj 123",
    });

    expect(result).toContain("MSG:Platba za obj 123");
  });

  it("strips spaces from IBAN", () => {
    const result = generateSpdString({
      iban: "CZ65 0800 0000 1920 0014 5399",
      amount: 100,
    });

    expect(result).toContain("ACC:CZ6508000000192000145399");
  });

  it("uppercases IBAN and BIC", () => {
    const result = generateSpdString({
      iban: "cz6508000000192000145399",
      amount: 100,
      bic: "kombczpp",
    });

    expect(result).toContain("ACC:CZ6508000000192000145399+KOMBCZPP");
  });

  it("defaults to CZK currency", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
    });

    expect(result).toContain("CC:CZK");
  });

  it("respects custom currency", () => {
    const result = generateSpdString({
      iban: "DE89370400440532013000",
      amount: 49.99,
      currency: "EUR",
    });

    expect(result).toContain("CC:EUR");
  });

  it("strips non-digit characters from variable symbol", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
      variableSymbol: "VS-123-456",
    });

    expect(result).toContain("X-VS:123456");
  });

  it("truncates variable symbol to 10 digits", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
      variableSymbol: "12345678901234",
    });

    expect(result).toContain("X-VS:1234567890");
    expect(result).not.toContain("X-VS:12345678901234");
  });

  it("truncates message to 60 characters", () => {
    const longMsg = "A".repeat(100);
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
      message: longMsg,
    });

    const msgPart = result.split("*").find((p) => p.startsWith("MSG:"));
    expect(msgPart).toBe(`MSG:${"A".repeat(60)}`);
  });

  it("strips asterisks from message", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
      message: "Pay*ment*test",
    });

    expect(result).toContain("MSG:Paymenttest");
  });

  it("omits variable symbol when empty", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
      variableSymbol: "",
    });

    expect(result).not.toContain("X-VS:");
  });

  it("omits variables symbol when null", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 100,
      variableSymbol: null,
    });

    expect(result).not.toContain("X-VS:");
  });

  it("produces correct full SPD string", () => {
    const result = generateSpdString({
      iban: "CZ6508000000192000145399",
      amount: 2500,
      bic: "KOMBCZPP",
      currency: "CZK",
      variableSymbol: "0000012345",
      message: "Objednavka 12345",
    });

    expect(result).toBe(
      "SPD*1.0*ACC:CZ6508000000192000145399+KOMBCZPP*AM:2500.00*CC:CZK*X-VS:0000012345*MSG:Objednavka 12345"
    );
  });
});

// ---------------------------------------------------------------------------
// BankTransferQrCode — component tests
// ---------------------------------------------------------------------------

describe("BankTransferQrCode", () => {
  const validData: BankTransferQrData = {
    iban: "CZ6508000000192000145399",
    amount: 1500,
    bic: "KOMBCZPP",
    currency: "CZK",
    variableSymbol: "1234567890",
  };

  it("renders card with QR code for valid data", () => {
    render(<BankTransferQrCode data={validData} />);

    expect(
      screen.getByText("checkout.bankTransfer.qrCode.title")
    ).toBeInTheDocument();
    expect(
      screen.getByText("checkout.bankTransfer.qrCode.description")
    ).toBeInTheDocument();
    // QRCodeSVG renders an SVG element
    expect(
      screen.getByLabelText("checkout.bankTransfer.qrCode.ariaLabel")
    ).toBeInTheDocument();
  });

  it("renders compact version without card wrapper", () => {
    render(<BankTransferQrCode data={validData} compact />);

    // Compact version has "scanToPay" text but no title
    expect(
      screen.getByText("checkout.bankTransfer.qrCode.scanToPay")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("checkout.bankTransfer.qrCode.title")
    ).not.toBeInTheDocument();
  });

  it("renders nothing when IBAN is empty", () => {
    const { container } = render(
      <BankTransferQrCode data={{ ...validData, iban: "" }} />
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when IBAN is only whitespace", () => {
    const { container } = render(
      <BankTransferQrCode data={{ ...validData, iban: "   " }} />
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders QR code SVG element", () => {
    render(<BankTransferQrCode data={validData} />);

    const svg = screen.getByLabelText("checkout.bankTransfer.qrCode.ariaLabel");
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("applies custom size", () => {
    render(<BankTransferQrCode data={validData} size={300} />);

    const svg = screen.getByLabelText("checkout.bankTransfer.qrCode.ariaLabel");
    expect(svg.getAttribute("width")).toBe("300");
    expect(svg.getAttribute("height")).toBe("300");
  });
});
