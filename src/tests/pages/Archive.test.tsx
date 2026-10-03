import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ArchivePage from "@/pages/Archive";

// Polyfill for react-pdf v10 (requires DOMMatrix)
if (!global.DOMMatrix) {
  global.DOMMatrix = class DOMMatrix {
    constructor(public values: number[] = [1, 0, 0, 1, 0, 0]) {}
    a = this.values[0];
    b = this.values[1];
    c = this.values[2];
    d = this.values[3];
    e = this.values[4];
    f = this.values[5];
  } as unknown as typeof globalThis.DOMMatrix;
}

// React Router v7+ has removed the future prop - v7 features are now default

const mockUseArchiveFilterOptions = vi.fn();
const mockUseArchiveDocuments = vi.fn();

vi.mock("@/components/layout/Header", () => ({
  Header: () => null,
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => null,
}));

vi.mock("@/components/archive/DocumentViewer", () => ({
  DocumentViewer: () => <div data-testid="mock-document-viewer">PDF Viewer</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, _opts?: unknown) => key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/hooks/useArchiveDocuments", () => ({
  useArchiveFilterOptions: () => mockUseArchiveFilterOptions(),
  useArchiveDocuments: (options: unknown) => mockUseArchiveDocuments(options),
  getLocalizedField: () => null,
  getLocalizedSummary: () => null,
}));

describe("Archive", () => {
  beforeEach(() => {
    mockUseArchiveFilterOptions.mockReset();
    mockUseArchiveDocuments.mockReset();

    mockUseArchiveFilterOptions.mockReturnValue({
      filterOptions: {
        decades: ["1960s", "1970s"],
        documentTypes: [],
        preparations: [],
        places: [],
        keywords: ["immune", "vitamin"],
      },
      loading: false,
    });

    mockUseArchiveDocuments.mockReturnValue({
      documents: [],
      loading: false,
      error: null,
    });
  });

  it("prefills decade filter from URL query param", async () => {
    render(
      <MemoryRouter initialEntries={["/archive?decade=1960s"]}>
        <ArchivePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockUseArchiveDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ decade: "1960s" })
      );
    });

    expect((await screen.findAllByText("1960s")).length).toBeGreaterThan(0);
  });

  it("prefills multiple filters from URL query params", async () => {
    mockUseArchiveFilterOptions.mockReturnValue({
      filterOptions: {
        decades: ["1960s"],
        documentTypes: ["operational_report"],
        preparations: ["tablet"],
        places: [],
        keywords: ["immune"],
      },
      loading: false,
    });

    render(
      <MemoryRouter
        initialEntries={["/archive?decade=1960s&type=operational_report&prep=tablet&tag=immune&q=immune"]}
      >
        <ArchivePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockUseArchiveDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({
          decade: "1960s",
          documentType: "operational_report",
          preparation: "tablet",
          keywords: ["immune"],
          searchQuery: "immune",
        })
      );
    });
  });

  it("supports multiple tag params in URL", async () => {
    mockUseArchiveFilterOptions.mockReturnValue({
      filterOptions: {
        decades: [],
        documentTypes: [],
        preparations: [],
        places: [],
        keywords: ["immune", "vitamin"],
      },
      loading: false,
    });

    render(
      <MemoryRouter
        initialEntries={["/archive?tag=immune&tag=vitamin"]}
      >
        <ArchivePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockUseArchiveDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({
          keywords: ["immune", "vitamin"],
        })
      );
    });
  });
});
