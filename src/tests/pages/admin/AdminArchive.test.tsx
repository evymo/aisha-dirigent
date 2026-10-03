import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Polyfill for Radix UI / jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import AdminArchive from "@/pages/admin/AdminArchive";

// Mock hooks
vi.mock("@/hooks/useArchiveAdmin", () => ({
  useArchiveDocumentsAdmin: vi.fn(),
  useCreateArchiveDocument: vi.fn(),
  useUpdateArchiveDocument: vi.fn(),
  useDeleteArchiveDocument: vi.fn(),
}));

vi.mock("@/hooks/useArchiveTags", () => ({
  useArchiveTags: vi.fn(),
  useCreateArchiveTag: vi.fn(),
  ARCHIVE_TAG_CATEGORIES: ["person", "keyword", "preparation", "facility", "place"],
}));

vi.mock("@/hooks/useArchiveStorage", () => ({
  uploadArchiveFile: vi.fn(),
}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useUpsertTranslations: () => ({
    mutateAsync: vi.fn().mockResolvedValue(null),
    isPending: false,
  }),
  useFetchTranslationsForKeys: () => ({
    mutateAsync: vi.fn().mockResolvedValue([]),
  }),
  SUPPORTED_LOCALES: ["cs", "en"],
  LOCALE_LABELS: { cs: "Čeština", en: "English" },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Import mocked hooks to set implementations
import {
  useArchiveDocumentsAdmin,
  useCreateArchiveDocument,
  useUpdateArchiveDocument,
  useDeleteArchiveDocument,
} from "@/hooks/useArchiveAdmin";

import {
  useArchiveTags,
  useCreateArchiveTag,
} from "@/hooks/useArchiveTags";

const mockDocuments = [
  {
    id: "doc-1",
    slug: "test-doc-1",
    title: "Test Document 1",
    description: "Document description",
    summary: null,
    content: "Document content",
    document_type: "operational_report",
    provenance_badge: "original_scan",
    year: 1985,
    decade: "1980",
    facility: "Test Facility",
    place: "Prague",
    preparation: "RTN-118",
    scan_url: "https://example.com/scan.pdf",
    transcript_url: null,
    editorial_note: null,
    what_you_are_looking_at: null,
    standards_context: null,
    source_publication: "Journal of Medicine",
    original_language: "cs",
    page_count: 5,
    is_featured: true,
    is_download_public: false,
    people: ["mudr_gabriel_urbanek"],
    keywords: ["t_faktor", "imunologie"],
    related_document_ids: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

const mockTags = [
  {
    id: "tag-1",
    code: "mudr_gabriel_urbanek",
    category: "person",
    name_key: "archive.tags.person.mudr_gabriel_urbanek",
    display_name: "MUDr. Gabriel Urbánek",
    sort_order: 0,
    is_active: true,
    usage_count: 4,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "tag-2",
    code: "t_faktor",
    category: "keyword",
    name_key: "archive.tags.keyword.t_faktor",
    display_name: "T-faktor",
    sort_order: 0,
    is_active: true,
    usage_count: 10,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

describe("AdminArchive page", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    // Setup default hook mocks
    vi.mocked(useArchiveDocumentsAdmin).mockReturnValue({
      data: mockDocuments,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useArchiveDocumentsAdmin>);

    vi.mocked(useCreateArchiveDocument).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateArchiveDocument>);

    vi.mocked(useUpdateArchiveDocument).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateArchiveDocument>);

    vi.mocked(useDeleteArchiveDocument).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteArchiveDocument>);

    vi.mocked(useArchiveTags).mockReturnValue({
      data: mockTags,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useArchiveTags>);

    vi.mocked(useCreateArchiveTag).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "new-tag-id", code: "new_tag" }),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateArchiveTag>);
  });

  afterEach(() => {
    queryClient.clear();
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AdminArchive />
      </QueryClientProvider>
    );

  describe("Document List", () => {
    it("should render page title and subtitle", () => {
      renderComponent();

      expect(screen.getByText("admin.archive.title")).toBeInTheDocument();
      // Subtitle appears in multiple places (header + card)
      const subtitles = screen.getAllByText("admin.archive.subtitle");
      expect(subtitles.length).toBeGreaterThan(0);
    });

    it("should render loading spinner when loading", () => {
      vi.mocked(useArchiveDocumentsAdmin).mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useArchiveDocumentsAdmin>);

      renderComponent();

      // Loading state shows spinner
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it("should render document list with data", async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText("Test Document 1")).toBeInTheDocument();
      });
    });

    it("should show add new document button", () => {
      renderComponent();

      expect(screen.getByText("admin.archive.addDocument")).toBeInTheDocument();
    });

    it("should handle empty document list gracefully", () => {
      vi.mocked(useArchiveDocumentsAdmin).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useArchiveDocumentsAdmin>);

      renderComponent();

      expect(screen.getByText("admin.archive.title")).toBeInTheDocument();
      expect(screen.getByText("admin.archive.addDocument")).toBeInTheDocument();
    });
  });

  describe("Create Dialog", () => {
    it("should open dialog when add button is clicked", async () => {
      const user = userEvent.setup();
      renderComponent();

      const addButton = screen.getByText("admin.archive.addDocument");
      await user.click(addButton);

      await waitFor(() => {
        // Dialog opens - looking for the dialog header that shows "addDocument" in create mode
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });
    });

    it("should render form fields in dialog", async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText("admin.archive.addDocument"));

      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });

      // Check for key form labels using regex to match with asterisk
      expect(screen.getByText(/admin\.archive\.form\.slug/)).toBeInTheDocument();
      expect(screen.getByText("admin.archive.form.documentType")).toBeInTheDocument();
    });

    it("should render collapsible sections", async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText("admin.archive.addDocument"));

      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });

      // Look for collapsible section headers
      expect(screen.getByText("admin.archive.sections.basicInfo")).toBeInTheDocument();
      expect(screen.getByText("admin.archive.sections.metadata")).toBeInTheDocument();
      expect(screen.getByText("admin.archive.sections.files")).toBeInTheDocument();
    });

    it("should call create mutation on form submit", { timeout: 30000 }, async () => {
      const user = userEvent.setup();
      const mockMutate = vi.fn();

      vi.mocked(useCreateArchiveDocument).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as unknown as ReturnType<typeof useCreateArchiveDocument>);

      renderComponent();

      await user.click(screen.getByText("admin.archive.addDocument"));

      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });

      // Fill slug field
      const slugInput = screen.getByPlaceholderText("admin.archive.placeholders.slug");
      await user.type(slugInput, "new-test-document");

      // Submit form
      const submitButton = screen.getByText("admin.archive.createDocument");
      expect(submitButton).toBeInTheDocument();
      const form = submitButton.closest("form");
      expect(form).not.toBeNull();
      
      // Use fireEvent for submit since Radix Dialog overlay can block userEvent click
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalled();
      });

      // Verify slug is in the call
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "new-test-document" }),
        expect.any(Object)
      );
    });
  });

  describe("Delete Confirmation", () => {
    it("should render delete confirmation dialog elements", async () => {
      const user = userEvent.setup();
      renderComponent();

      // Find the actions dropdown trigger (MoreHorizontal icon button)
      const menuTriggers = screen.getAllByRole("button", { name: "common.openMenu" });
      expect(menuTriggers.length).toBeGreaterThan(0);

      // Click to open dropdown
      await user.click(menuTriggers[0]);

      // Now delete option should be visible
      await waitFor(() => {
        expect(screen.getByText("common.delete")).toBeInTheDocument();
      });
    });
  });

  describe("DataTable integration", () => {
    it("should render table headers", () => {
      renderComponent();

      // Check for table column headers
      expect(screen.getByText("admin.archive.table.year")).toBeInTheDocument();
      expect(screen.getByText("admin.archive.table.type")).toBeInTheDocument();
      expect(screen.getByText("admin.archive.table.title")).toBeInTheDocument();
    });

    it("should display document data in table", async () => {
      renderComponent();

      await waitFor(() => {
        // Year from mock data
        expect(screen.getByText("1985")).toBeInTheDocument();
        // Title from mock data
        expect(screen.getByText("Test Document 1")).toBeInTheDocument();
      });
    });

    it("should render search input", () => {
      renderComponent();

      const searchInput = screen.getByPlaceholderText("Search...");
      expect(searchInput).toBeInTheDocument();
    });
  });

  describe("Hooks integration", () => {
    it("should call useArchiveDocumentsAdmin on mount", () => {
      renderComponent();

      expect(useArchiveDocumentsAdmin).toHaveBeenCalled();
    });

    it("should call useCreateArchiveDocument for mutation setup", () => {
      renderComponent();

      expect(useCreateArchiveDocument).toHaveBeenCalled();
    });

    it("should call useUpdateArchiveDocument for mutation setup", () => {
      renderComponent();

      expect(useUpdateArchiveDocument).toHaveBeenCalled();
    });

    it("should call useDeleteArchiveDocument for mutation setup", () => {
      renderComponent();

      expect(useDeleteArchiveDocument).toHaveBeenCalled();
    });
  });

  describe("Form validation behavior", () => {
    it("should call mutation with form data on submit", async () => {
      const user = userEvent.setup();
      const mockMutate = vi.fn();

      vi.mocked(useCreateArchiveDocument).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as unknown as ReturnType<typeof useCreateArchiveDocument>);

      renderComponent();

      await user.click(screen.getByText("admin.archive.addDocument"));

      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });

      // Fill the slug field
      const slugInput = screen.getByPlaceholderText("admin.archive.placeholders.slug");
      await user.type(slugInput, "test-slug");

      // Submit - use fireEvent since Radix Dialog overlay blocks userEvent click
      const submitButton = screen.getByText("admin.archive.createDocument");
      const form = submitButton.closest("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);

      // Mutation should be called with the slug
      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalled();
      });
    });
  });

  describe("Tag inputs in form", () => {
    it("should render people tag input field", async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText("admin.archive.addDocument"));

      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });

      // People field label
      expect(screen.getByText("admin.archive.form.people")).toBeInTheDocument();
    });

    it("should render keywords tag input field", async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText("admin.archive.addDocument"));

      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });

      // Keywords field label
      expect(screen.getByText("admin.archive.form.keywords")).toBeInTheDocument();
    });
  });

  describe("Pending state", () => {
    it("should show loading state when create mutation is pending", async () => {
      const user = userEvent.setup();
      
      vi.mocked(useCreateArchiveDocument).mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof useCreateArchiveDocument>);

      renderComponent();

      await user.click(screen.getByText("admin.archive.addDocument"));

      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeInTheDocument();
      });

      // Submit button should be disabled when pending
      const buttons = screen.getAllByRole("button");
      const submitButton = buttons.find(btn => btn.getAttribute("type") === "submit");
      expect(submitButton).toBeDisabled();
    });
  });
});
