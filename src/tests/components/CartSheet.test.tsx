import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CartSheet } from "@/components/cart/CartSheet";
import userEvent from "@testing-library/user-event";

// React Router v7+ has removed the future prop - v7 features are now default

const mockUseCart = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => mockUseCart(),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseAuth(),
}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => ({}),
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (amount: number) => `€${amount.toFixed(2)}`,
    formatCurrency: (amount: number) => `€${amount.toFixed(2)}`,
    convertAmount: (amount: number) => amount,
    convertFromBase: (amount: number) => amount,
    preferredCurrency: "EUR",
    baseCurrency: "EUR",
    availableCurrencies: ["EUR", "CZK", "USD"],
    rates: {},
    isLoading: false,
    storedCurrency: null,
    getRateToCzk: () => 1,
    setPreferredCurrency: vi.fn(),
  }),
}));

describe("CartSheet", () => {
  beforeEach(() => {
    mockUseCart.mockReset();
    mockUseAuth.mockReset();
  });

  it("prompts sign in when user is not authenticated", async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ user: null, session: null });
    mockUseCart.mockReturnValue({ items: [], loading: false, itemCount: 0 });

    render(
      <MemoryRouter>
        <CartSheet>
          <button>Open cart</button>
        </CartSheet>
      </MemoryRouter>
    );

    await user.click(screen.getByText("Open cart"));
    expect(screen.getByText("cart.signInToView")).toBeInTheDocument();
  });

  it("shows loading state when cart is loading", async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ user: { id: '1' }, session: { user: { id: '1' } } });
    mockUseCart.mockReturnValue({ items: [], loading: true, itemCount: 0 });

    render(
      <MemoryRouter>
        <CartSheet>
          <button>Open cart</button>
        </CartSheet>
      </MemoryRouter>
    );

    await user.click(screen.getByText("Open cart"));
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders items and handles quantity changes", async () => {
    const user = userEvent.setup();
    const mockUpdateQuantity = vi.fn();
    const mockRemove = vi.fn();

    mockUseAuth.mockReturnValue({ user: { id: '1' }, session: { user: { id: '1' } } });
    mockUseCart.mockReturnValue({
      items: [
        {
          id: "1",
          quantity: 1,
          product_id: "p1",
          product: { name: "Product A", price: 9.99, image_url: "/img.png" },
        },
      ],
      isLoading: false,
      total: 9.99,
      itemCount: 1,
      updateQuantity: mockUpdateQuantity,
      removeFromCart: mockRemove,
    });

    render(
      <MemoryRouter>
        <CartSheet>
          <button>Open cart</button>
        </CartSheet>
      </MemoryRouter>
    );

    await user.click(screen.getByText("Open cart"));

    expect(screen.getByText("Product A")).toBeInTheDocument();
    expect(screen.getAllByText("€9.99")[0]).toBeInTheDocument();

    await user.click(screen.getByLabelText("Increase quantity"));
    expect(mockUpdateQuantity).toHaveBeenCalledWith("1", 2);

    await user.click(screen.getByLabelText("Remove item"));
    expect(mockRemove).toHaveBeenCalledWith("1");
  });
});
