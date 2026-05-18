import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface AccountResult {
  contact_id: string;
  full_name: string;
  contact_type: string;
}

interface AccountIdSearchProps {
  value: string;
  onChange: (accountId: string, name: string) => void;
  className?: string;
  disabled?: boolean;
  contactTypes?: Array<'borrower' | 'lender' | 'broker'>;
}

export const AccountIdSearch: React.FC<AccountIdSearchProps> = ({
  value,
  onChange,
  className,
  disabled = false,
  contactTypes = ['borrower', 'lender'],
}) => {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<AccountResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const searchAccounts = useCallback(async (searchTerm: string) => {
    setIsLoading(true);
    try {
      let qb = supabase
        .from('contacts')
        .select('contact_id, full_name, contact_type')
        .in('contact_type', ['borrower', 'lender']);

      if (searchTerm && searchTerm.length >= 1) {
        qb = qb.or(`contact_id.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`);
      }

      const { data, error } = await qb
        .order('contact_id', { ascending: true })
        .limit(50);

      if (error) throw error;
      setResults(
        (data || []).map((row: any) => ({
          contact_id: row.contact_id,
          full_name: row.full_name || '',
          contact_type: row.contact_type,
        }))
      );
      setIsOpen(true);
    } catch (err) {
      console.error('Account search error:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val, '');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAccounts(val), 500);
  };

  const handleSelect = (account: AccountResult) => {
    setQuery(account.contact_id);
    setIsOpen(false);
    setResults([]);
    onChange(account.contact_id, account.full_name);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1">
      <Input
        value={query}
        onChange={handleInputChange}
        onFocus={() => searchAccounts(query)}
        placeholder="Search"
        className={cn('h-6 text-xs pr-6', className)}
        disabled={disabled}
      />
      {isLoading ? (
        <Loader2 className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground animate-spin" />
      ) : (
        <Search className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
      )}

      {isOpen && (
        <div className="absolute z-[9999] top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-y-auto min-w-[200px]">
          {results.length > 0 ? (
            results.map((account) => (
              <button
                key={`${account.contact_type}-${account.contact_id}`}
                type="button"
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors flex justify-between items-center gap-2"
                onClick={() => handleSelect(account)}
              >
                <span className="font-medium">{account.contact_id}</span>
                <span className="text-muted-foreground truncate">{account.full_name}</span>
                <span className="text-[10px] text-muted-foreground capitalize shrink-0">({account.contact_type})</span>
              </button>
            ))
          ) : (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No accounts found</div>
          )}
        </div>
      )}
    </div>
  );
};

export default AccountIdSearch;
