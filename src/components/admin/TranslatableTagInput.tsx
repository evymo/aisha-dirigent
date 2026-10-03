/**
 * TranslatableTagInput
 * 
 * User-friendly tag selector with autocomplete and inline creation.
 * Supports dynamic translations for tag names.
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
  useArchiveTags,
  useCreateArchiveTag,
  type ArchiveTagCategory,
  type ArchiveTag,
} from "@/hooks/useArchiveTags";
import {
  useUpsertTranslations,
  useDynamicT,
  type TranslationInput,
  SUPPORTED_LOCALES,
} from "@/hooks/useDynamicTranslations";
import { cn } from "@/lib/utils";

interface TranslatableTagInputProps {
  /** Tag category */
  category: ArchiveTagCategory;
  /** Selected tag codes */
  value: string[];
  /** Callback when selection changes */
  onChange: (codes: string[]) => void;
  /** Label for the field */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Allow creating new tags */
  allowCreate?: boolean;
  /** Maximum number of tags */
  maxTags?: number;
  /** CSS class name */
  className?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
}

/**
 * Single tag badge with translated name
 */
function TagBadge({
  tag,
  onRemove,
  disabled,
}: {
  tag: ArchiveTag;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const displayName = useDynamicT(tag.name_key, "archive") || tag.display_name;

  return (
    <Badge variant="secondary" className="flex items-center gap-1 pr-1">
      {displayName}
      {!disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

/**
 * Fallback badge for tags not in database (legacy data)
 */
function LegacyTagBadge({
  code,
  onRemove,
  disabled,
}: {
  code: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <Badge variant="outline" className="flex items-center gap-1 pr-1 border-dashed">
      {code}
      {!disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

export function TranslatableTagInput({
  category,
  value,
  onChange,
  label: _label,
  placeholder,
  allowCreate = true,
  maxTags,
  className,
  disabled,
}: TranslatableTagInputProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const { data: allTags = [], isLoading } = useArchiveTags(category);
  const createTag = useCreateArchiveTag();
  const upsertTranslations = useUpsertTranslations();

  // Map codes to tags
  const tagsByCode = useMemo(() => {
    const map = new Map<string, ArchiveTag>();
    allTags.forEach((tag) => map.set(tag.code, tag));
    return map;
  }, [allTags]);

  // Selected tags (with lookup)
  const selectedTags = value.map((code) => ({
    code,
    tag: tagsByCode.get(code),
  }));

  // Available tags (not selected)
  const availableTags = useMemo(() => {
    const selectedSet = new Set(value);
    return allTags.filter((tag) => !selectedSet.has(tag.code));
  }, [allTags, value]);

  // Filtered by search
  const filteredTags = useMemo(() => {
    if (!search.trim()) return availableTags;
    const lower = search.toLowerCase();
    return availableTags.filter(
      (tag) =>
        tag.code.toLowerCase().includes(lower) ||
        tag.display_name.toLowerCase().includes(lower)
    );
  }, [availableTags, search]);

  const canAddMore = !maxTags || value.length < maxTags;

  const handleSelect = (code: string) => {
    if (canAddMore && !value.includes(code)) {
      onChange([...value, code]);
    }
    setSearch("");
    setOpen(false);
  };

  const handleRemove = (code: string) => {
    onChange(value.filter((c) => c !== code));
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    const code = newTagName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9áčďéěíňóřšťúůýž]+/gi, "_")
      .replace(/^_+|_+$/g, "");

    if (tagsByCode.has(code)) {
      toast.error(t("admin.archive.tags.alreadyExists"));
      return;
    }

    try {
      setIsCreating(true);

      // Create the tag
      await createTag.mutateAsync({
        code,
        category,
        display_name: newTagName.trim(),
      });

      // Create translations for all locales
      const nameKey = `archive.tags.${category}.${code}`;
      const translations: TranslationInput[] = SUPPORTED_LOCALES.map((locale) => ({
        key: nameKey,
        locale,
        value: newTagName.trim(), // Same value for all locales initially
        namespace: "archive",
      }));

      await upsertTranslations.mutateAsync(translations);

      // Add to selection
      handleSelect(code);
      setNewTagName("");
      setIsCreating(false);
      toast.success(t("admin.archive.tags.created"));
    } catch (error) {
      setIsCreating(false);
      toast.error(t("admin.archive.tags.createError"));
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Selected tags */}
      <div className="flex flex-wrap gap-2 min-h-[32px]">
        {selectedTags.map(({ code, tag }) =>
          tag ? (
            <TagBadge
              key={code}
              tag={tag}
              onRemove={() => handleRemove(code)}
              disabled={disabled}
            />
          ) : (
            <LegacyTagBadge
              key={code}
              code={code}
              onRemove={() => handleRemove(code)}
              disabled={disabled}
            />
          )
        )}

        {/* Add button */}
        {canAddMore && !disabled && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={isLoading}
              >
                <Plus className="h-3 w-3 mr-1" />
                {placeholder || t("admin.archive.tags.add")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder={t("admin.archive.tags.search")}
                  value={search}
                  onValueChange={setSearch}
                />
                <CommandList>
                  <CommandEmpty>
                    {allowCreate ? (
                      <div className="p-2 space-y-2">
                        <p className="text-sm text-muted-foreground">
                          {t("admin.archive.tags.notFound")}
                        </p>
                        <div className="flex gap-2">
                          <Input
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            placeholder={t("admin.archive.tags.newName")}
                            className="h-8"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleCreateTag();
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            onClick={handleCreateTag}
                            disabled={isCreating || !newTagName.trim()}
                          >
                            {isCreating ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground p-2">
                        {t("admin.archive.tags.noResults")}
                      </p>
                    )}
                  </CommandEmpty>
                  <CommandGroup>
                    {filteredTags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.code}
                        onSelect={() => handleSelect(tag.code)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value.includes(tag.code) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {tag.display_name}
                        {tag.usage_count > 0 && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            ({tag.usage_count})
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

export default TranslatableTagInput;
