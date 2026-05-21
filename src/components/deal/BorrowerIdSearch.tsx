import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Plus } from 'lucide-react';
import { searchContactsByType, createContact } from '@/services/contacts/contacts.service';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import { toast } from 'sonner';

interface BorrowerContact {
  contact_id: string;
  full_name: string;
  contact_data: Record<string, any>;
}

interface BorrowerIdSearchProps {
  value: string;
  onChange: (borrowerId: string, borrowerFullName: string, contactData?: Record<string, any>) => void;
  className?: string;
  disabled?: boolean;
}

export const BorrowerIdSearch: React.FC<BorrowerIdSearchProps> = ({
  value,
  onChange,
  className,
  disabled = false,
}) => {
  const { user } = useAuth();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<BorrowerContact[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const searchBorrowers = useCallback(async (searchTerm: string) => {
    setIsLoading(true);
    try {
      const data = await searchContactsByType('borrower', searchTerm, 50);
      const mapped = (data || []).map((row: any) => ({
        contact_id: row.contact_id,
        full_name: row.full_name || '',
        contact_data: (row.contact_data as Record<string, any>) || {},
      }));
      setResults(mapped);
      setIsOpen(true);
    } catch (err) {
      console.error('Borrower search error:', err);
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
    debounceRef.current = setTimeout(() => searchBorrowers(val), 300);
  };

  const handleSelect = (borrower: BorrowerContact) => {
    setQuery(borrower.contact_id);
    setIsOpen(false);
    setResults([]);
    onChange(borrower.contact_id, borrower.full_name, borrower.contact_data);
  };

  const handleAddNew = () => {
    setIsOpen(false);
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (data: Record<string, string>) => {
    if (!user) return;
    try {
      const fullName = data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim();
      await createContact({
        contactType: 'borrower',
        createdBy: user.id,
        contactData: data,
      });

      toast.success('Borrower created');
      setCreateModalOpen(false);

      const rows = await searchContactsByType('borrower', fullName, 1);
      const contactId = rows[0]?.contact_id || '';
      setQuery(contactId);
      onChange(contactId, fullName, data);
    } catch (err: any) {
      console.error('Error creating borrower:', err);
      toast.error('Failed to create borrower');
    }
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
    <>
      <div ref={containerRef} className="relative flex-1">
        <Input
          value={query}
          onChange={handleInputChange}
          onFocus={() => searchBorrowers(query)}
          placeholder="Search Borrower ID or Name"
          className={cn('h-8 text-xs pr-8', className)}
          disabled={disabled}
        />
        {isLoading ? (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
        ) : (
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        )}

        {isOpen && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-56 overflow-y-auto">
            {results.length > 0 ? (
              results.map((borrower) => (
                <button
                  key={borrower.contact_id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex justify-between items-center"
                  onClick={() => handleSelect(borrower)}
                >
                  <span className="font-medium">{borrower.contact_id}</span>
                  <span className="text-muted-foreground truncate ml-2">{borrower.full_name}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">No borrowers found</div>
            )}
            <div className="border-t border-border">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2 text-primary font-medium"
                onClick={handleAddNew}
              >
                <Plus className="h-3.5 w-3.5" />
                Add New Borrower
              </button>
            </div>
          </div>
        )}
      </div>

      <CreateContactModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        contactType="borrower"
        onSubmit={handleCreateSubmit}
      />
    </>
  );
};

export default BorrowerIdSearch;
