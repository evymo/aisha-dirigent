import React from "react";
import { cn } from "@/lib/utils";

interface ChatMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Lightweight markdown renderer for chat messages.
 * Handles: **bold**, > blockquotes, newlines, inline `code`.
 * Does NOT use heavy external libraries — keeps bundle size minimal.
 */
export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let blockquoteBuffer: string[] = [];

  const flushBlockquote = () => {
    if (blockquoteBuffer.length === 0) return;
    elements.push(
      <blockquote
        key={`bq-${elements.length}`}
        className="border-l-2 border-violet-300 dark:border-violet-600 pl-3 py-1 my-1 text-sm text-muted-foreground"
      >
        {blockquoteBuffer.map((bqLine, i) => (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {renderInline(bqLine)}
          </React.Fragment>
        ))}
      </blockquote>,
    );
    blockquoteBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blockquote lines
    if (trimmed.startsWith("> ")) {
      blockquoteBuffer.push(trimmed.substring(2));
      continue;
    }

    // Flush any pending blockquote
    flushBlockquote();

    // Empty line = spacing
    if (!trimmed) {
      elements.push(<div key={`sp-${i}`} className="h-1" />);
      continue;
    }

    // Regular line with inline formatting
    elements.push(
      <React.Fragment key={`ln-${i}`}>
        {i > 0 && elements.length > 0 && !lines[i - 1].trim().startsWith(">") && lines[i - 1].trim() !== "" && <br />}
        {renderInline(trimmed)}
      </React.Fragment>,
    );
  }

  flushBlockquote();

  return <div className={cn("text-sm", className)}>{elements}</div>;
}

/** Render inline markdown: **bold**, `code` */
function renderInline(text: string): React.ReactNode {
  // Split by **bold** and `code` patterns
  const parts: React.ReactNode[] = [];
  // Regex: **bold** or `code`
  const inlineRegex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    if (match[2]) {
      // **bold**
      parts.push(<strong key={`b-${match.index}`} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      // `code`
      parts.push(
        <code key={`c-${match.index}`} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
          {match[3]}
        </code>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
