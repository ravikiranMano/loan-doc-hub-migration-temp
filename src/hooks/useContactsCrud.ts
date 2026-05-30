import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { normalizeBrokerLicenseFields, validateBrokerLicenseFields } from '@/lib/licenseNumberValidation';

export interface ContactRecord {
  id: string;
  contact_id: string;
  contact_type: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  company: string;
  contact_data: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export type ContactType =
  | 'lender'
  | 'broker'
  | 'borrower'
  | 'additional_guarantor'
  | 'authorized_party'
  | 'attorney';

interface UseContactsCrudOptions {
  contactType: ContactType;
  pageSize?: number;
}

export function useContactsCrud({ contactType, pageSize = 10 }: UseContactsCrudOptions) {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchContacts = useCallback(async (page: number, search: string) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      // Count query
      let countQuery = supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('contact_type', contactType);

      if (search) {
        countQuery = countQuery.or(
          `full_name.ilike.%${search}%,email.ilike.%${search}%,contact_id.ilike.%${search}%,city.ilike.%${search}%,state.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`
        );
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;
      setTotalCount(count || 0);

      // Data query
      let dataQuery = supabase
        .from('contacts')
        .select('*')
        .eq('contact_type', contactType)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (search) {
        dataQuery = dataQuery.or(
          `full_name.ilike.%${search}%,email.ilike.%${search}%,contact_id.ilike.%${search}%,city.ilike.%${search}%,state.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`
        );
      }

      const { data, error } = await dataQuery;
      if (error) throw error;

      setContacts((data || []).map((row: any) => ({
        ...row,
        contact_data: (row.contact_data as Record<string, string>) || {},
      })));
    } catch (err: any) {
      console.error('Error fetching contacts:', err);
      toast.error('Failed to load contacts');
    } finally {
      setIsLoading(false);
    }
  }, [user, contactType, pageSize]);

  useEffect(() => {
    fetchContacts(currentPage, searchQuery);
  }, [currentPage, searchQuery, fetchContacts]);

  const createContact = useCallback(async (contactData: Record<string, string>) => {
    if (!user) return null;
    try {
      const normalizedContactData = contactType === 'broker' ? normalizeBrokerLicenseFields(contactData) : contactData;
      if (contactType === 'broker') {
        const licenseError = validateBrokerLicenseFields(normalizedContactData);
        if (licenseError) { toast.error(licenseError); return null; }
      }
      const fullName = normalizedContactData.full_name || `${normalizedContactData.first_name || ''} ${normalizedContactData.last_name || ''}`.trim();
      
      // Generate contact_id via DB function
      const { data: idData, error: idError } = await supabase.rpc('generate_contact_id', { p_type: contactType });
      if (idError) throw idError;

      const insertPayload = {
        contact_type: contactType,
        contact_id: idData as string,
        created_by: user.id,
        full_name: fullName,
        first_name: normalizedContactData.first_name || normalizedContactData['first_name'] || '',
        last_name: normalizedContactData.last_name || normalizedContactData['last_name'] || '',
        email: normalizedContactData.email || '',
        phone: normalizedContactData.phone || normalizedContactData['phone.cell'] || normalizedContactData['phone.mobile'] || normalizedContactData['phone.home'] || normalizedContactData['phone.work'] || '',
        city: normalizedContactData.city || normalizedContactData['address.city'] || normalizedContactData['primary_address.city'] || '',
        state: normalizedContactData.state || normalizedContactData['address.state'] || normalizedContactData['primary_address.state'] || '',
        company: normalizedContactData.company || '',
        contact_data: normalizedContactData,
      };

      const { data, error } = await supabase
        .from('contacts')
        .insert(insertPayload)
        .select()
        .single();

      if (error) throw error;
      toast.success(`${contactType.charAt(0).toUpperCase() + contactType.slice(1)} created`);
      fetchContacts(currentPage, searchQuery);
      return data;
    } catch (err: any) {
      console.error('Error creating contact:', err);
      toast.error('Failed to create contact');
      return null;
    }
  }, [user, contactType, currentPage, searchQuery, fetchContacts]);

  const updateContact = useCallback(async (id: string, contactData: Record<string, string>) => {
    if (!user) return false;
    try {
      const normalizedContactData = contactType === 'broker' ? normalizeBrokerLicenseFields(contactData) : contactData;
      if (contactType === 'broker') {
        const licenseError = validateBrokerLicenseFields(normalizedContactData);
        if (licenseError) { toast.error(licenseError); return false; }
      }
      const fullName = normalizedContactData.full_name || `${normalizedContactData.first_name || ''} ${normalizedContactData.last_name || ''}`.trim();

      // Preserve underscore-prefixed internal keys (e.g. _events_journal, _charges, _conversation_log, _trust_ledger)
      const { data: existing } = await supabase
        .from('contacts')
        .select('contact_data')
        .eq('id', id)
        .single();

      const existingData = (existing?.contact_data as Record<string, any>) || {};
      const mergedData: Record<string, any> = { ...normalizedContactData };
      Object.entries(existingData).forEach(([key, value]) => {
        if (key.startsWith('_')) {
          mergedData[key] = value;
        }
      });
      
      const { error } = await supabase
        .from('contacts')
        .update({
          full_name: fullName,
          first_name: normalizedContactData.first_name || '',
          last_name: normalizedContactData.last_name || '',
          email: normalizedContactData.email || '',
          phone: normalizedContactData.phone || normalizedContactData['phone.cell'] || normalizedContactData['phone.mobile'] || normalizedContactData['phone.home'] || normalizedContactData['phone.work'] || '',
          city: normalizedContactData.city || normalizedContactData['address.city'] || normalizedContactData['primary_address.city'] || '',
          state: normalizedContactData.state || normalizedContactData['address.state'] || normalizedContactData['primary_address.state'] || '',
          company: normalizedContactData.company || '',
          contact_data: mergedData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      // Sync updated contact fields back to any linked deal_participants
      const phoneValue = normalizedContactData.phone || normalizedContactData['phone.cell'] || normalizedContactData['phone.mobile'] || normalizedContactData['phone.home'] || normalizedContactData['phone.work'] || '';
      const { data: linkedParticipants } = await supabase
        .from('deal_participants')
        .select('id, deal_id')
        .eq('contact_id', id);

      if (linkedParticipants && linkedParticipants.length > 0) {
        const participantIds = linkedParticipants.map((p: any) => p.id);
        await supabase
          .from('deal_participants')
          .update({
            name: fullName,
            email: normalizedContactData.email || '',
            phone: phoneValue,
          })
          .in('id', participantIds);

        // Sync per-deal capacity into deal_section_values (section='participants')
        // so the Participants grid reflects updated Capacity from the contact record.
        const newCapacity = (normalizedContactData.capacity || '').toString().trim();
        if (newCapacity) {
          const dealIds = Array.from(
            new Set(linkedParticipants.map((p: any) => p.deal_id).filter(Boolean))
          );
          for (const dealId of dealIds) {
            const capacityKey = `participant_${id}_capacity`;
            const { data: existingSection } = await supabase
              .from('deal_section_values')
              .select('id, field_values')
              .eq('deal_id', dealId)
              .eq('section', 'participants')
              .maybeSingle();

            const existingFv = (existingSection?.field_values as Record<string, any>) || {};
            const updatedFv = { ...existingFv, [capacityKey]: newCapacity };

            if (existingSection?.id) {
              await supabase
                .from('deal_section_values')
                .update({ field_values: updatedFv, updated_at: new Date().toISOString() })
                .eq('id', existingSection.id);
            } else {
              await supabase
                .from('deal_section_values')
                .insert({ deal_id: dealId, section: 'participants', field_values: updatedFv });
            }
          }
        }
      }

      toast.success('Contact saved');
      fetchContacts(currentPage, searchQuery);
      return true;
    } catch (err: any) {
      console.error('Error updating contact:', err);
      toast.error('Failed to save contact');
      return false;
    }
  }, [user, currentPage, searchQuery, fetchContacts]);

  const deleteContact = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) throw error;
      toast.success('Contact deleted');
      fetchContacts(currentPage, searchQuery);
      return true;
    } catch (err: any) {
      console.error('Error deleting contact:', err);
      toast.error('Failed to delete contact');
      return false;
    }
  }, [currentPage, searchQuery, fetchContacts]);

  const deleteContacts = useCallback(async (ids: string[]) => {
    try {
      // Remove linked deal_participants first to avoid FK constraint violations
      const { error: dpError } = await supabase
        .from('deal_participants')
        .delete()
        .in('contact_id', ids);
      if (dpError) {
        console.warn('Could not remove linked deal participants:', dpError);
      }

      // Also remove linked borrower_attachments
      const { error: baError } = await supabase
        .from('borrower_attachments')
        .delete()
        .in('contact_id', ids);
      if (baError) {
        console.warn('Could not remove linked borrower attachments:', baError);
      }

      const { error } = await supabase.from('contacts').delete().in('id', ids);
      if (error) throw error;
      toast.success(`${ids.length} contact${ids.length !== 1 ? 's' : ''} deleted`);
      fetchContacts(currentPage, searchQuery);
      return true;
    } catch (err: any) {
      console.error('Error deleting contacts:', err);
      toast.error('Failed to delete contacts');
      return false;
    }
  }, [currentPage, searchQuery, fetchContacts]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    contacts,
    totalCount,
    totalPages,
    currentPage,
    setCurrentPage,
    searchQuery,
    setSearchQuery,
    isLoading,
    createContact,
    updateContact,
    deleteContact,
    deleteContacts,
    refresh: () => fetchContacts(currentPage, searchQuery),
  };
}
