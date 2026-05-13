import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import { toast } from 'sonner';

interface LenderContact {
  contact_id: string;
  full_name: string;
  contact_data: Record<string, any>;
}

interface LenderIdSearchProps {
  value: string;
  onChange: (lenderId: string, lenderFullName: string, contactData?: Record<string, any>) => void;
  className?: string;
  disabled?: boolean;
}

export const LenderIdSearch: React.FC<LenderIdSearchProps> = ({
  value,
  onChange,
  className,
  disabled = false,
}) => {
  const { user } = useAuth();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<LenderContact[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync external value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const searchLenders = useCallback(async (searchTerm: string) => {
    setIsLoading(true);
    try {
      let qb = supabase
        .from('contacts')
        .select('contact_id, full_name, contact_data, email, phone')
        .eq('contact_type', 'lender');

      if (searchTerm && searchTerm.length >= 1) {
        qb = qb.or(`contact_id.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`);
      }

      const { data, error } = await qb
        .order('contact_id', { ascending: true })
        .limit(50);

      if (error) throw error;
      const mapped = (data || []).map((row: any) => ({
        contact_id: row.contact_id,
        full_name: row.full_name || '',
        contact_data: (row.contact_data as Record<string, any>) || {},
      }));
      setResults(mapped);
      setIsOpen(true);
    } catch (err) {
      console.error('Lender search error:', err);
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
    debounceRef.current = setTimeout(() => searchLenders(val), 300);
  };

  const handleSelect = (lender: LenderContact) => {
    setQuery(lender.contact_id);
    setIsOpen(false);
    setResults([]);
    onChange(lender.contact_id, lender.full_name, lender.contact_data);
  };

  const handleAddNew = () => {
    setIsOpen(false);
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (data: Record<string, string>) => {
    if (!user) return;
    try {
      const fullName = data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim();

      const { data: idData, error: idError } = await supabase.rpc('generate_contact_id', { p_type: 'lender' });
      if (idError) throw idError;

      const contactId = idData as string;
      const insertPayload = {
        contact_type: 'lender' as const,
        contact_id: contactId,
        created_by: user.id,
        full_name: fullName,
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.email || '',
        phone: data.phone || data['phone.cell'] || data['phone.home'] || data['phone.work'] || '',
        city: data['primary_address.city'] || data.city || '',
        state: data['primary_address.state'] || data.state || '',
        company: data.company || '',
        contact_data: data,
      };

      const { error } = await supabase.from('contacts').insert(insertPayload);
      if (error) throw error;

      toast.success('Lender created');
      setCreateModalOpen(false);

      // Auto-select the newly created lender
      setQuery(contactId);
      onChange(contactId, fullName, data);
    } catch (err: any) {
      console.error('Error creating lender:', err);
      toast.error('Failed to create lender');
    }
  };

  // Close dropdown on outside click
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
          onFocus={() => searchLenders(query)}
          placeholder="Search Lender ID or Name"
          className={cn('h-7 text-sm pr-8', className)}
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
              results.map((lender) => (
                <button
                  key={lender.contact_id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex justify-between items-center"
                  onClick={() => handleSelect(lender)}
                >
                  <span className="font-medium">{lender.contact_id}</span>
                  <span className="text-muted-foreground truncate ml-2">{lender.full_name}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">No lenders found</div>
            )}
            <div className="border-t border-border">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2 text-primary font-medium"
                onClick={handleAddNew}
              >
                <Plus className="h-3.5 w-3.5" />
                Add New Lender
              </button>
            </div>
          </div>
        )}
      </div>

      <CreateContactModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        contactType="lender"
        onSubmit={handleCreateSubmit}
      />
    </>
  );
};

export default LenderIdSearch;
