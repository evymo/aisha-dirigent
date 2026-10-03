import { useEffect, useRef } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import type { CellState, CellType } from './types';

interface SpreadsheetCellProps {
  active: boolean;
  cellState: CellState;
  columnKey: string;
  displayValue: string;
  editValue: string;
  format?: (value: unknown) => string;
  onCellClick: () => void;
  onEditValueChange: (value: string) => void;
  options?: { label: string; value: string }[];
  readonly: boolean;
  type: CellType;
}

/** Individual cell component — renders display or editor based on state */
export function SpreadsheetCell({
  active,
  cellState,
  columnKey,
  displayValue,
  editValue,
  onCellClick,
  onEditValueChange,
  options,
  readonly,
  type,
}: SpreadsheetCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = active && cellState === 'editing';

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (isEditing && !readonly) {
    return (
      <td
        className={cn(
          'border border-primary bg-primary/5 p-0',
        )}
      >
        {type === 'combo' ? (
          <Select
            onValueChange={(val) => onEditValueChange(val)}
            value={editValue}
          >
            <SelectTrigger className="h-8 rounded-none border-0 text-xs focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : type === 'toggle' ? (
          <div className="flex h-8 items-center justify-center px-2">
            <Switch
              checked={editValue === 'true'}
              onCheckedChange={(checked) => onEditValueChange(String(checked))}
            />
          </div>
        ) : (
          <Input
            className="h-8 rounded-none border-0 px-2 text-xs focus-visible:ring-0"
            onChange={(e) => onEditValueChange(e.target.value)}
            ref={inputRef}
            type={type === 'number' || type === 'price' ? 'number' : 'text'}
            value={editValue}
          />
        )}
      </td>
    );
  }

  // Display mode
  return (
    <td
      className={cn(
        'cursor-pointer border border-transparent px-2 py-1 text-xs transition-colors',
        active && cellState === 'focused' && 'border-primary/50 bg-primary/5',
        active && 'ring-1 ring-inset ring-primary/30',
        !active && 'hover:bg-muted/50',
      )}
      onClick={onCellClick}
    >
      {type === 'toggle' ? (
        <div className="flex items-center justify-center">
          <div
            className={cn(
              'h-3 w-3 rounded-full',
              displayValue === 'true' ? 'bg-green-500' : 'bg-muted-foreground/30',
            )}
          />
        </div>
      ) : type === 'price' ? (
        <span className="font-mono tabular-nums">
          {displayValue ? `${Number(displayValue).toFixed(2)}` : ''}
        </span>
      ) : type === 'number' ? (
        <span className="font-mono tabular-nums">{displayValue}</span>
      ) : (
        <span className="truncate">{displayValue}</span>
      )}
    </td>
  );
}
