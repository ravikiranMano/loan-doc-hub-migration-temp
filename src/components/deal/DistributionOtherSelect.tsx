import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';

export type OtherEntityType = 'broker' | 'lender';

export interface OtherEntitySelection {
  id: string;
  type: OtherEntityType;
  name: string;
}

interface DistributionOtherSelectProps {
  entityId: string;
  entityType: string;
  entityName: string;
  onChange: (sel: OtherEntitySelection | null) => void;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
}

interface BLOption {
  id: string;          // contact uuid
  type: OtherEntityType;
  name: string;        // display name
}

// Module-scoped cache so opening multiple Distribution rows shares one fetch.
let cachedOptions: BLOption[] | null = null;
let inflight: Promise<BLOption[]> | null = null;

async function fetchBrokersAndLenders(): Promise<BLOption[]> {
  if (cachedOptions) return cachedOptions;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, contact_type, full_name, first_name, last_name, company')
      .in('contact_type', ['broker', 'lender'])
      .order('full_name', { ascending: true })
      .limit(2000);
    if (error) {
      console.error('DistributionOtherSelect fetch error:', error);
      inflight = null;
      return [];
    }
    const seen = new Set<string>();
    const out: BLOption[] = [];
    for (const row of (data || []) as any[]) {
      const type = (row.contact_type === 'broker' ? 'broker' : 'lender') as OtherEntityType;
      const display =
        (row.full_name && String(row.full_name).trim()) ||
        [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
        (row.company && String(row.company).trim()) ||
        '(Unnamed)';
      const key = `${type}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: row.id, type, name: display });
    }
    cachedOptions = out;
    inflight = null;
    return out;
  })();
  return inflight;
}

export const DistributionOtherSelect: React.FC<DistributionOtherSelectProps> = ({
  entityId, entityType, entityName, onChange, disabled, hasError, className,
}) => {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<BLOption[]>(cachedOptions || []);
  const [loading, setLoading] = useState(!cachedOptions);

  useEffect(() => {
    let alive = true;
    if (cachedOptions) {
      setOptions(cachedOptions);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchBrokersAndLenders().then((opts) => {
      if (!alive) return;
      setOptions(opts);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const brokers = useMemo(() => options.filter(o => o.type === 'broker'), [options]);
  const lenders = useMemo(() => options.filter(o => o.type === 'lender'), [options]);

  const currentKey = entityId && entityType ? `${entityType}:${entityId}` : '';
  const displayLabel = entityName || (entityId && entityType ? `${entityType === 'broker' ? 'Broker' : 'Lender'}` : '');

  const handleSelect = (opt: BLOption) => {
    onChange({ id: opt.id, type: opt.type, name: opt.name });
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange(null);
  };

  const showClear = !disabled && !!currentKey;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn(
            'h-7 w-full justify-between text-sm font-normal px-3',
            !currentKey && 'text-muted-foreground',
            hasError && 'border-destructive',
            className,
          )}
        >
          <span className="truncate">
            {currentKey ? displayLabel : 'Select Broker or Lender'}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {showClear && (
              <span
                role="button"
                aria-label="Clear selection"
                tabIndex={-1}
                onMouseDown={handleClear}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0 z-[9999]" align="start">
        <Command>
          <CommandInput placeholder="Search broker or lender..." className="h-8" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading...
              </div>
            ) : (
              <>
                <CommandEmpty>No matches.</CommandEmpty>
                {brokers.length > 0 && (
                  <CommandGroup heading="Brokers">
                    {brokers.map((opt) => {
                      const k = `${opt.type}:${opt.id}`;
                      return (
                        <CommandItem
                          key={k}
                          value={`broker ${opt.name}`}
                          onSelect={() => handleSelect(opt)}
                        >
                          <Check className={cn('mr-2 h-3 w-3', currentKey === k ? 'opacity-100' : 'opacity-0')} />
                          <span className="truncate">{opt.name}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
                {lenders.length > 0 && (
                  <CommandGroup heading="Lenders">
                    {lenders.map((opt) => {
                      const k = `${opt.type}:${opt.id}`;
                      return (
                        <CommandItem
                          key={k}
                          value={`lender ${opt.name}`}
                          onSelect={() => handleSelect(opt)}
                        >
                          <Check className={cn('mr-2 h-3 w-3', currentKey === k ? 'opacity-100' : 'opacity-0')} />
                          <span className="truncate">{opt.name}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default DistributionOtherSelect;
