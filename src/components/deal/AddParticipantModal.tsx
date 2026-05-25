import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  searchContactsForParticipant,
  getContactContactData,
  patchContactData,
  createContact,
} from '@/services/contacts/contacts.service';
import {
  findParticipantByDealContactRole,
  findParticipantByDealEmailRole,
  insertParticipant,
} from '@/services/deals/participants.service';
import {
  fetchSectionValueByDealAndSection,
  upsertParticipantsSectionValues,
} from '@/services/deals/section-values.service';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Search, UserPlus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AddParticipantModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  onParticipantAdded: () => void;
}

interface ContactResult {
  id: string;
  contact_id: string;
  full_name: string;
  email: string;
  phone: string;
  contact_type: string;
}

type ParticipantType =
  | 'borrower'
  | 'co_borrower'
  | 'lender'
  | 'broker'
  | 'additional_guarantor'
  | 'authorized_party'
  | 'other';

const PARTICIPANT_TYPES = [
  { value: 'borrower', label: 'Borrower', disabled: false },
  { value: 'lender', label: 'Lender', disabled: false },
  { value: 'broker', label: 'Broker', disabled: false },
  { value: 'additional_guarantor', label: 'Additional Guarantor', disabled: false },
  { value: 'authorized_party', label: 'Authorized Party', disabled: false },
];

// Types that don't map to a native app_role enum value — persisted as 'other' role
// with the original selection retained as the participant's capacity label.
const EXTENDED_TYPE_LABELS: Record<string, string> = {
  co_borrower: 'Co-borrower',
  additional_guarantor: 'Additional Guarantor',
  authorized_party: 'Authorized Party',
};
const NATIVE_ROLES = new Set(['borrower', 'lender', 'broker', 'other']);

export const AddParticipantModal: React.FC<AddParticipantModalProps> = ({
  open,
  onOpenChange,
  dealId,
  onParticipantAdded,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [participantType, setParticipantType] = useState<ParticipantType | ''>('');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [saving, setSaving] = useState(false);
  const [capacity, setCapacity] = useState('');

  // Existing contact search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContactResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null);

  // New contact fields
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setStep('type');
      setParticipantType('');
      setMode('existing');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedContact(null);
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setCapacity('');
    }
  }, [open]);

  // Search contacts when query changes
  useEffect(() => {
    if (!searchQuery.trim() || !participantType) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const q = searchQuery.trim();
        const data = await searchContactsForParticipant(participantType, q, 10);
        setSearchResults(
          (data || []).map((c: Record<string, string>) => ({
            id: c.id,
            contact_id: c.contact_id || '',
            full_name: c.full_name || '',
            email: c.email || '',
            phone: c.phone || '',
            contact_type: c.contact_type,
          }))
        );
      } catch (err) {
        console.error('Error searching contacts:', err);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery, participantType]);

  const handleTypeSelected = () => {
    if (participantType) {
      setStep('details');
    }
  };

  const handleSave = async () => {
    if (!participantType || !dealId) return;

    // DB constraint `external_role_only` restricts deal_participants.role to
    // borrower/broker/lender. Extended types (additional_guarantor, authorized_party,
    // co_borrower) are persisted under role='borrower' and disambiguated by capacity.
    const EXTERNAL_ROLES = new Set(['borrower', 'lender', 'broker']);
    const persistedRole: 'borrower' | 'lender' | 'broker' = EXTERNAL_ROLES.has(participantType)
      ? (participantType as 'borrower' | 'lender' | 'broker')
      : 'borrower';
    // Resolve the capacity label: explicit selection > extended type label > participant type.
    const resolvedCapacity =
      capacity || EXTENDED_TYPE_LABELS[participantType] || participantType;

    setSaving(true);
    try {
      let contactId: string | null = null;
      let name = '';
      let email = '';
      let phone = '';

      if (mode === 'existing' && selectedContact) {
        contactId = selectedContact.id;
        name = selectedContact.full_name;
        email = selectedContact.email;
        phone = selectedContact.phone;

        // Update contact_data with capacity/role for existing contact
        await patchContactData(selectedContact.id, {
          full_name: name,
          email,
          capacity: resolvedCapacity,
          ...(phone ? { 'phone.home': phone } : {}),
          ...(name
            ? {
                first_name: name.split(' ')[0] || '',
                last_name: name.split(' ').slice(1).join(' ') || '',
              }
            : {}),
        });
      } else if (mode === 'new') {
        name = newName.trim();
        email = newEmail.trim();
        phone = newPhone.trim();

        if (!name) {
          toast.error('Name is required');
          setSaving(false);
          return;
        }

        // Create new contact - preserve AG/AP/native types; fall back to borrower otherwise
        const VALID_CONTACT_TYPES = new Set(['borrower', 'lender', 'broker', 'additional_guarantor', 'authorized_party']);
        const contactType = VALID_CONTACT_TYPES.has(participantType)
          ? participantType
          : 'borrower';
        const contactDataPayload: Record<string, string> = {
          full_name: name,
          first_name: name.split(' ')[0] || '',
          last_name: name.split(' ').slice(1).join(' ') || '',
          capacity: resolvedCapacity,
        };
        if (email) contactDataPayload.email = email;
        if (phone) contactDataPayload['phone.home'] = phone;

        const newContact = await createContact({
          contactType: contactType as 'borrower',
          createdBy: user?.id || '',
          contactData: contactDataPayload,
        });
        contactId = newContact.id;
      }

      // Check if participant already exists for this deal (by contact_id + type, or email + type)
      if (contactId) {
        const existing = await findParticipantByDealContactRole(
          dealId,
          contactId,
          persistedRole
        );

        if (existing) {
          toast.error('This participant already exists in this file');
          setSaving(false);
          return;
        }
      } else if (email) {
        const existing = await findParticipantByDealEmailRole(dealId, email, persistedRole);

        if (existing) {
          toast.error('This participant already exists in this file');
          setSaving(false);
          return;
        }
      }

      // Insert deal participant
      await insertParticipant({
        deal_id: dealId,
        role: persistedRole,
        name,
        email: email || null,
        phone: phone || null,
        contact_id: contactId,
        status: 'invited',
        access_method: 'login',
      });

      // Persist capacity per-deal in deal_section_values (section='participants')
      if (contactId && resolvedCapacity) {
        const capacityKey = `participant_${contactId}_capacity`;
        const existingSection = await fetchSectionValueByDealAndSection(dealId, 'participants');
        const existingValues = (existingSection?.field_values as Record<string, unknown>) || {};
        await upsertParticipantsSectionValues(dealId, {
          ...existingValues,
          [capacityKey]: resolvedCapacity,
        });
      }


      toast.success('Participant added successfully');
      onParticipantAdded();
      onOpenChange(false);

      // Only navigate to contact detail page for NEW contacts
      if (mode === 'new' && contactId) {
        const route =
          participantType === 'lender' ? 'lenders'
          : participantType === 'broker' ? 'brokers'
          : participantType === 'additional_guarantor' ? 'additional-guarantors'
          : participantType === 'authorized_party' ? 'authorized-parties'
          : 'borrowers';
        setTimeout(() => {
          navigate(`/contacts/${route}/${contactId}`);
        }, 300);
      }
    } catch (err: any) {
      console.error('Error adding participant:', err);
      toast.error(err.message || 'Failed to add participant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Add Participant
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 py-3 sleek-scrollbar">
          {step === 'type' ? (
            <div className="space-y-4">
              <Label className="text-sm font-medium">Select Participant Type</Label>
              <Select value={participantType} onValueChange={(v) => setParticipantType(v as ParticipantType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  {PARTICIPANT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} disabled={t.disabled} className={t.disabled ? 'opacity-50' : ''}>
                      {t.label}{t.disabled ? ' (Disabled)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Participant Type - changeable inline */}
              <div className="mb-4">
                <Label className="text-sm font-medium mb-1.5 block">Type</Label>
                <Select value={participantType} onValueChange={(v) => {
                  setParticipantType(v as ParticipantType);
                  setCapacity('');
                  setSelectedContact(null);
                  setSearchQuery('');
                  setSearchResults([]);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    {PARTICIPANT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} disabled={t.disabled} className={t.disabled ? 'opacity-50' : ''}>
                        {t.label}{t.disabled ? ' (Disabled)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Capacity field intentionally hidden for Additional Guarantor / Authorized Party — capacity is auto-set from participant type */}



              <div className="flex gap-2">
                <Button
                  variant={mode === 'existing' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMode('existing')}
                  className="gap-1"
                >
                  <Search className="h-3.5 w-3.5" />
                  Existing Contact
                </Button>
                <Button
                  variant={mode === 'new' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMode('new')}
                  className="gap-1"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  New Contact
                </Button>
              </div>

              {mode === 'existing' ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, email, or ID..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSelectedContact(null);
                      }}
                      className="pl-8"
                    />
                  </div>

                  {searching && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Searching...
                    </div>
                  )}

                  {searchResults.length > 0 && (
                    <div className="border border-border rounded-md max-h-[200px] overflow-y-auto">
                      {searchResults.map((contact) => (
                        <div
                          key={contact.id}
                          onClick={() => setSelectedContact(contact)}
                          className={cn(
                            'p-3 cursor-pointer border-b last:border-b-0 hover:bg-muted/50 transition-colors',
                            selectedContact?.id === contact.id && 'bg-primary/5 border-primary/20'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-foreground">{contact.full_name}</p>
                              <p className="text-xs text-muted-foreground">{contact.email || 'No email'}</p>
                            </div>
                            <span className="text-xs text-muted-foreground">{contact.contact_id}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchQuery && !searching && searchResults.length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">
                      No contacts found. Try a different search or add a new contact.
                    </p>
                  )}

                  {selectedContact && (
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <p className="text-sm font-medium text-foreground">Selected: {selectedContact.full_name}</p>
                      <p className="text-xs text-muted-foreground">{selectedContact.email} • {selectedContact.phone || 'No phone'}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm">Name *</Label>
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Email</Label>
                    <EmailInput
                      value={newEmail}
                      onValueChange={(v) => setNewEmail(v)}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Phone</Label>
                    <PhoneInput
                      value={newPhone}
                      onValueChange={(val) => setNewPhone(val)}
                      placeholder="(555) 555-5555"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {step === 'type' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleTypeSelected} disabled={!participantType}>Next</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('type')}>Back</Button>
              <Button
                onClick={handleSave}
                disabled={
                  saving ||
                  (mode === 'existing' && !selectedContact) ||
                  (mode === 'new' && !newName.trim())
                }
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save & Go to Contact
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddParticipantModal;
