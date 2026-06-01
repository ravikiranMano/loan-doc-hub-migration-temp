import { useState, useCallback, useEffect } from 'react';
import {
  listContacts,
  createContact as createContactRecord,
  updateContactWithMerge,
  deleteContact as deleteContactRecord,
  deleteContacts as deleteContactsRecords,
  type ContactRecord,
} from '@/services/contacts/contacts.service';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { normalizeBrokerLicenseFields, validateBrokerLicenseFields } from '@/lib/licenseNumberValidation';

export type { ContactRecord };

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

function prepareBrokerContactData(
  contactType: ContactType,
  contactData: Record<string, string>,
): { data: Record<string, string>; error: string | null } {
  const data =
    contactType === 'broker' ? normalizeBrokerLicenseFields(contactData) : contactData;
  if (contactType === 'broker') {
    const licenseError = validateBrokerLicenseFields(data);
    if (licenseError) return { data, error: licenseError };
  }
  return { data, error: null };
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
      const { contacts: rows, totalCount: count } = await listContacts({
        contactType,
        page,
        pageSize,
        search: search || undefined,
      });
      setTotalCount(count);
      setContacts(
        rows.map((row) => ({
          ...row,
          contact_data: (row.contact_data as Record<string, string>) || {},
        }))
      );
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
      const { data: normalizedContactData, error: licenseError } = prepareBrokerContactData(
        contactType,
        contactData,
      );
      if (licenseError) {
        toast.error(licenseError);
        return null;
      }

      const data = await createContactRecord({
        contactType,
        createdBy: user.id,
        contactData: normalizedContactData,
      });
      toast.success(`${contactType.charAt(0).toUpperCase() + contactType.slice(1)} created`);
      fetchContacts(currentPage, searchQuery);
      return data;
    } catch (err: any) {
      console.error('Error creating contact:', err);
      toast.error('Failed to create contact');
      return null;
    }
  }, [user, contactType, currentPage, searchQuery, fetchContacts]);

  const updateContact = useCallback(async (
    id: string,
    contactData: Record<string, string>,
    opts?: { newContactId?: string },
  ) => {
    if (!user) return false;
    try {
      const { data: normalizedContactData, error: licenseError } = prepareBrokerContactData(
        contactType,
        contactData,
      );
      if (licenseError) {
        toast.error(licenseError);
        return false;
      }

      await updateContactWithMerge(id, normalizedContactData, {
        newContactId: opts?.newContactId,
        contactType,
      });

      toast.success('Contact saved');
      fetchContacts(currentPage, searchQuery);
      return true;
    } catch (err: any) {
      console.error('Error updating contact:', err);
      const message = err?.message || 'Failed to save contact';
      toast.error(message);
      return false;
    }
  }, [user, contactType, currentPage, searchQuery, fetchContacts]);

  const deleteContact = useCallback(async (id: string) => {
    try {
      await deleteContactRecord(id);
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
      await deleteContactsRecords(ids);
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
