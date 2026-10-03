import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizujStitek } from "@/lib/novinky/stitky";

/**
 * Vstup pro volné štítky (news_articles.tags): odznaky + řádek s nabídkou už
 * použitých štítků. Enter nebo čárka přidá, Backspace v prázdném poli odebere
 * poslední. Štítek se normalizuje (trim, malá písmena, mezery → pomlčky), aby
 * „Vajra Family" a „vajra-family" nebyly dva různé filtry.
 *
 * Archivní `TranslatableTagInput` se nehodí: je vázaný na taxonomii archivu
 * (osoba/klíčové slovo/místo…), kdežto štítky novinek jsou volný text, který
 * autor volí jako popis obsahu.
 */
export interface StitkyInputProps {
  value: string[];
  onChange: (stitky: string[]) => void;
  /** Nabídka (typicky štítky už použité v jiných článcích). */
  nabidka?: string[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function StitkyInput({ value, onChange, nabidka = [], placeholder, disabled, id, className }: StitkyInputProps) {
  const [text, setText] = useState("");

  const hledany = normalizujStitek(text);
  const navrhy = nabidka
    .filter((n) => !value.includes(n))
    .filter((n) => (hledany ? n.includes(hledany) : true))
    .slice(0, 8);

  const pridej = (surovy: string) => {
    const stitek = normalizujStitek(surovy);
    if (!stitek || value.includes(stitek)) {
      setText("");
      return;
    }
    onChange([...value, stitek]);
    setText("");
  };
  const odeber = (stitek: string) => onChange(value.filter((s) => s !== stitek));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      pridej(text);
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      odeber(value[value.length - 1]);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 min-h-10">
        {value.map((stitek) => (
          <Badge key={stitek} variant="secondary" className="gap-1 pr-1">
            {stitek}
            {!disabled ? (
              <button
                type="button"
                aria-label={`${stitek} ×`}
                className="rounded-sm hover:bg-muted"
                onClick={() => odeber(stitek)}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </Badge>
        ))}
        <Input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => text && pridej(text)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-7 flex-1 min-w-[8rem] border-0 px-1 shadow-none focus-visible:ring-0"
        />
      </div>
      {!disabled && navrhy.length > 0 ? (
        <div className="flex flex-wrap gap-1" role="listbox" aria-label="tags">
          {navrhy.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={false}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => pridej(n)}
            >
              + {n}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
