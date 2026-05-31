import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

export type ContactKind =
  | 'borrower'
  | 'broker'
  | 'lender'
  | 'additional_guarantor'
  | 'authorized_party'
  | 'attorney';

export interface OpenContact {
  id: string;            // contacts.id (uuid)
  kind: ContactKind;
  contactId: string;     // human contact_id (e.g. B-00018)
  fullName: string;
  openedAt: number;
}

interface ContactWorkspaceState {
  openContacts: OpenContact[];
  activeContactId: string | null;
  openContact: (c: OpenContact) => boolean;
  closeContact: (id: string) => void;
  switchToContact: (id: string) => void;
  setContactDirty: (id: string, dirty: boolean) => void;
  isContactDirty: (id: string) => boolean;
  isAtLimit: () => boolean;
  registerSaveFn: (id: string, fn: () => Promise<boolean>) => void;
  unregisterSaveFn: (id: string) => void;
  getSaveFn: (id: string) => (() => Promise<boolean>) | undefined;
  updateContactId: (id: string, newContactId: string, fullName?: string) => void;
}

const MAX_CONTACTS = 10;
const STORAGE_KEY_LIST = 'contactWorkspace_openContacts';
const STORAGE_KEY_ACTIVE = 'contactWorkspace_activeContactId';

function loadList(): OpenContact[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_LIST);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function loadActive(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY_ACTIVE) || null; } catch { return null; }
}

const ContactWorkspaceContext = createContext<ContactWorkspaceState | null>(null);

export const ContactWorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [openContacts, setOpenContacts] = useState<OpenContact[]>(loadList);
  const [activeContactId, setActiveContactId] = useState<string | null>(loadActive);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(openContacts));
  }, [openContacts]);

  useEffect(() => {
    if (activeContactId) sessionStorage.setItem(STORAGE_KEY_ACTIVE, activeContactId);
    else sessionStorage.removeItem(STORAGE_KEY_ACTIVE);
  }, [activeContactId]);

  const openContact = useCallback((c: OpenContact): boolean => {
    let opened = false;
    setOpenContacts(prev => {
      if (prev.find(p => p.id === c.id)) {
        opened = true;
        return prev;
      }
      if (prev.length >= MAX_CONTACTS) {
        opened = false;
        return prev;
      }
      opened = true;
      return [...prev, c];
    });
    setActiveContactId(c.id);
    return opened;
  }, []);

  const closeContact = useCallback((id: string) => {
    setOpenContacts(prev => prev.filter(p => p.id !== id));
    setDirty(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev); next.delete(id); return next;
    });
    setActiveContactId(prev => prev === id ? null : prev);
  }, []);

  const switchToContact = useCallback((id: string) => {
    setActiveContactId(id);
  }, []);

  const setContactDirty = useCallback((id: string, isDirty: boolean) => {
    setDirty(prev => {
      const has = prev.has(id);
      if (isDirty && has) return prev;
      if (!isDirty && !has) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const isContactDirty = useCallback((id: string) => dirtyRef.current.has(id), []);
  const isAtLimit = useCallback(() => openContacts.length >= MAX_CONTACTS, [openContacts]);

  const saveFnsRef = useRef<Record<string, () => Promise<boolean>>>({});
  const registerSaveFn = useCallback((id: string, fn: () => Promise<boolean>) => {
    saveFnsRef.current[id] = fn;
  }, []);
  const unregisterSaveFn = useCallback((id: string) => {
    delete saveFnsRef.current[id];
  }, []);
  const getSaveFn = useCallback((id: string) => saveFnsRef.current[id], []);

  return (
    <ContactWorkspaceContext.Provider value={{
      openContacts, activeContactId,
      openContact, closeContact, switchToContact,
      setContactDirty, isContactDirty, isAtLimit,
      registerSaveFn, unregisterSaveFn, getSaveFn,
    }}>
      {children}
    </ContactWorkspaceContext.Provider>
  );
};

export const useContactWorkspace = (): ContactWorkspaceState => {
  const ctx = useContext(ContactWorkspaceContext);
  if (!ctx) throw new Error('useContactWorkspace must be used within ContactWorkspaceProvider');
  return ctx;
};

export const useContactWorkspaceOptional = () => useContext(ContactWorkspaceContext);
