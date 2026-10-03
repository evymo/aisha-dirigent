/**
 * Popover-based dropdown for use in sticky filter bars.
 *
 * Unlike Radix Select, Popover does NOT lock body scroll when open,
 * so it works correctly inside `position: sticky` containers without
 * causing scroll-jump or off-screen rendering issues.
 *
 * Features:
 * - No body scroll lock (unlike Radix Select)
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Single-select (`FilterDropdown`) and multi-select (`FilterDropdownMulti`)
 *
 * @module components/ui/filter-dropdown
 */

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface FilterDropdownOption {
  label: string;
  value: string;
}

interface FilterDropdownProps {
  /** Currently selected value (pass `null` for "all"/unselected state) */
  value: string | null;
  /** Called with the raw value, or `null` when the "all" option is picked */
  onValueChange: (value: string | null) => void;
  /** Text shown when nothing is selected */
  placeholder: string;
  /** The list of selectable options (excluding the "all" entry) */
  options: FilterDropdownOption[];
  /** Label for the "show all" entry; defaults to placeholder */
  allLabel?: string;
  /** Optional className for the trigger button */
  className?: string;
}

/**
 * A lightweight filter dropdown that uses Popover (no scroll-lock)
 * instead of Radix Select. Designed for sticky filter bars.
 */
export function FilterDropdown({
  value,
  onValueChange,
  placeholder,
  options,
  allLabel,
  className,
}: FilterDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selectedLabel = React.useMemo(() => {
    if (!value) return null;
    const found = options.find((o) => o.value === value);
    return found?.label ?? value;
  }, [value, options]);

  const handleSelect = (v: string | null) => {
    onValueChange(v);
    setOpen(false);
  };

  /** Focus first item when popover opens */
  const handleOpenAutoFocus = React.useCallback((e: Event) => {
    e.preventDefault();
    const first = listRef.current?.querySelector<HTMLButtonElement>('[role="option"]');
    first?.focus();
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            className,
          )}
        >
          <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
            {selectedLabel ?? placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        ref={listRef}
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-[8rem] max-h-72 overflow-y-auto p-1"
        onOpenAutoFocus={handleOpenAutoFocus}
        onKeyDown={(e) => handleListKeyDown(e, listRef)}
      >
        {/* "All" option */}
        <DropdownItem
          selected={value === null}
          onSelect={() => handleSelect(null)}
        >
          {allLabel ?? placeholder}
        </DropdownItem>

        {options.map((opt) => (
          <DropdownItem
            key={opt.value}
            selected={value === opt.value}
            onSelect={() => handleSelect(opt.value)}
          >
            {opt.label}
          </DropdownItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Multi-select variant — picks are additive (no "current value" highlight). */
interface FilterDropdownMultiProps {
  /** Already selected values */
  selected: string[];
  /** Called when a new value is toggled */
  onToggle: (value: string) => void;
  placeholder: string;
  options: FilterDropdownOption[];
  className?: string;
}

export function FilterDropdownMulti({
  selected,
  onToggle,
  placeholder,
  options,
  className,
}: FilterDropdownMultiProps) {
  const [open, setOpen] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  /** Focus first item when popover opens */
  const handleOpenAutoFocus = React.useCallback((e: Event) => {
    e.preventDefault();
    const first = listRef.current?.querySelector<HTMLButtonElement>('[role="option"]');
    first?.focus();
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            className,
          )}
        >
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
            {selected.length > 0
              ? `${placeholder} (${selected.length})`
              : placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        ref={listRef}
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-[8rem] max-h-72 overflow-y-auto p-1"
        onOpenAutoFocus={handleOpenAutoFocus}
        onKeyDown={(e) => handleListKeyDown(e, listRef)}
      >
        {options.map((opt) => (
          <DropdownItem
            key={opt.value}
            selected={selected.includes(opt.value)}
            onSelect={() => onToggle(opt.value)}
          >
            {opt.label}
          </DropdownItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* ── Keyboard navigation helper ─────────────────────────────── */

function handleListKeyDown(
  e: React.KeyboardEvent<HTMLDivElement>,
  listRef: React.RefObject<HTMLDivElement | null>,
) {
  const items = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
  if (!items?.length) return;

  const active = document.activeElement as HTMLButtonElement | null;
  const idx = active ? Array.from(items).indexOf(active) : -1;

  switch (e.key) {
    case "ArrowDown": {
      e.preventDefault();
      const next = idx < items.length - 1 ? idx + 1 : 0;
      items[next].focus();
      break;
    }
    case "ArrowUp": {
      e.preventDefault();
      const prev = idx > 0 ? idx - 1 : items.length - 1;
      items[prev].focus();
      break;
    }
    case "Home": {
      e.preventDefault();
      items[0].focus();
      break;
    }
    case "End": {
      e.preventDefault();
      items[items.length - 1].focus();
      break;
    }
  }
}

/* ── Internal item ──────────────────────────────────────────── */

function DropdownItem({
  children,
  selected,
  onSelect,
}: {
  children: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none",
        "hover:bg-accent hover:text-accent-foreground",
        "focus:bg-accent focus:text-accent-foreground",
        selected && "font-medium",
      )}
    >
      {selected && (
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-4 w-4" />
        </span>
      )}
      <span className="truncate">{children}</span>
    </button>
  );
}
