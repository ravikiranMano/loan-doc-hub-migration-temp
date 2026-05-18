import React, { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  hasError?: boolean;
  /** Show an X button to clear selection. Defaults to true. */
  clearable?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onValueChange,
  options,
  placeholder = 'Select',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  triggerClassName,
  disabled,
  hasError,
  clearable = true,
}) => {
  const [open, setOpen] = useState(false);
  const showClear = clearable && !!value && !disabled;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn(
            'h-7 w-full flex-1 justify-between text-sm font-normal px-3',
            !value && 'text-muted-foreground',
            hasError && 'border-destructive',
            triggerClassName
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <span className="flex items-center gap-1 shrink-0">
            {showClear && (
              <span
                role="button"
                aria-label="Clear selection"
                tabIndex={-1}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onValueChange('');
                  setOpen(false);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 z-[9999] w-[var(--radix-popover-trigger-width)] bg-background border border-border" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 px-2 text-xs text-muted-foreground">{emptyText}</CommandEmpty>
            <CommandGroup>
              {clearable && value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onValueChange('');
                    setOpen(false);
                  }}
                  className="text-xs text-muted-foreground"
                >
                  <X className="mr-2 h-3.5 w-3.5" />
                  Clear selection
                </CommandItem>
              )}
              {options.map((opt) => {
                const selected = value === opt;
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      onValueChange(opt);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3.5 w-3.5', selected ? 'opacity-100' : 'opacity-0')} />
                    {opt}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
