import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ConversationList } from "@/components/chat/ConversationList";
import type { Conversation } from "@/hooks/useAiChat";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "aiChat.conversations.title": "Conversation History",
        "aiChat.conversations.count": `${opts?.count ?? 0} conversations`,
        "aiChat.conversations.empty": "No conversations yet.",
        "aiChat.conversations.untitled": "Untitled conversation",
        "aiChat.conversations.messages": "messages",
        "aiChat.conversations.archive": "Archive conversation",
        "aiChat.conversations.yesterday": "Yesterday",
        "aiChat.conversations.daysAgo": `${opts?.count ?? 0} days ago`,
        "aiChat.newConversation": "New Conversation",
      };
      return map[key] ?? key;
    },
  }),
}));

const mockConversations: Conversation[] = [
  {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    title: "Test conversation 1",
    status: "active",
    message_count: 5,
    created_at: "2026-02-17T10:00:00Z",
    last_message_at: "2026-02-17T12:00:00Z",
  },
  {
    id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    title: "Test conversation 2",
    status: "active",
    message_count: 3,
    created_at: "2026-02-16T10:00:00Z",
    last_message_at: "2026-02-16T15:00:00Z",
  },
  {
    id: "cccccccc-dddd-4eee-8fff-000000000000",
    title: "",
    status: "active",
    message_count: 0,
    created_at: "2026-02-10T10:00:00Z",
    last_message_at: null,
  },
];

describe("ConversationList", () => {
  const defaultProps = {
    conversations: mockConversations,
    isLoading: false,
    activeConversationId: undefined as string | undefined,
    onSelect: vi.fn(),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onNewConversation: vi.fn(),
    onBack: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render conversation list with title and count", () => {
    render(<ConversationList {...defaultProps} />);

    expect(screen.getByText("Conversation History")).toBeInTheDocument();
    expect(screen.getByText("3 conversations")).toBeInTheDocument();
  });

  it("should render each conversation with title and message count", () => {
    render(<ConversationList {...defaultProps} />);

    expect(screen.getByText("Test conversation 1")).toBeInTheDocument();
    expect(screen.getByText("Test conversation 2")).toBeInTheDocument();
    // Empty title should show untitled
    expect(screen.getByText("Untitled conversation")).toBeInTheDocument();
  });

  it("should display message count for each conversation", () => {
    render(<ConversationList {...defaultProps} />);

    // Message counts render as "X messages" text nodes
    expect(screen.getByText(/5\s+messages/)).toBeInTheDocument();
    expect(screen.getByText(/3\s+messages/)).toBeInTheDocument();
  });

  it("should highlight active conversation", () => {
    render(
      <ConversationList
        {...defaultProps}
        activeConversationId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
      />
    );

    const activeItem = screen.getByText("Test conversation 1").closest("[role='button']");
    expect(activeItem?.className).toContain("bg-muted");
  });

  it("should call onSelect and onBack when conversation is clicked", () => {
    render(<ConversationList {...defaultProps} />);

    fireEvent.click(screen.getByText("Test conversation 1"));

    expect(defaultProps.onSelect).toHaveBeenCalledWith("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(defaultProps.onBack).toHaveBeenCalled();
  });

  it("should call onArchive when archive button is clicked", async () => {
    render(<ConversationList {...defaultProps} />);

    const archiveButtons = screen.getAllByTitle("Archive conversation");
    expect(archiveButtons.length).toBe(3);

    fireEvent.click(archiveButtons[0]);

    await waitFor(() => {
      expect(defaultProps.onArchive).toHaveBeenCalledWith("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    });
  });

  it("should call onNewConversation and onBack when new conversation button is clicked", () => {
    render(<ConversationList {...defaultProps} />);

    fireEvent.click(screen.getByText("New Conversation"));

    expect(defaultProps.onNewConversation).toHaveBeenCalled();
    expect(defaultProps.onBack).toHaveBeenCalled();
  });

  it("should call onBack when back button is clicked", () => {
    render(<ConversationList {...defaultProps} />);

    // The back button is the first button in the header (ChevronLeft icon)
    const header = screen.getByText("Conversation History").closest(".flex");
    const buttons = header?.querySelectorAll("button");
    // First button in the header flex row is the back button
    const backButton = buttons?.[0];
    expect(backButton).toBeTruthy();
    fireEvent.click(backButton!);

    expect(defaultProps.onBack).toHaveBeenCalled();
  });

  it("should show loading spinner when isLoading is true", () => {
    render(<ConversationList {...defaultProps} isLoading={true} />);

    // Loader2 renders as svg with animate-spin class
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();
  });

  it("should show empty state when no conversations", () => {
    render(<ConversationList {...defaultProps} conversations={[]} />);

    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
  });

  it("should not leak sensitive data data in rendered output", () => {
    render(<ConversationList {...defaultProps} />);

    // Only IDs, titles, counts should be visible — no user data
    const html = document.body.innerHTML;
    expect(html).not.toContain("email");
    expect(html).not.toContain("password");
  });
});
