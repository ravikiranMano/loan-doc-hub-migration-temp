import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { searchParticipantsWithEmail } from '@/services/deals/participants.service';
import { listProfiles } from '@/services/admin/profiles.service';
import { invokeSendMessage } from '@/services/supabase/functions';
import {
  Send,
  Paperclip,
  X,
  Search,
  Mail,
  MessageSquare,
  Loader2,
  User,
  Building2,
  UserCheck,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Recipient {
  id: string;
  name: string;
  email: string;
  type: 'contact' | 'user' | 'external';
  role?: string;
}

interface Attachment {
  filename: string;
  content: string; // base64
  size: number;
}

interface GlobalMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const GlobalMessageDialog: React.FC<GlobalMessageDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [messageType, setMessageType] = useState<'email' | 'sms'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<Recipient[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);

  // Recipient search
  const [recipientSearch, setRecipientSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeRecipientTab, setActiveRecipientTab] = useState('contacts');

  // Manual external recipient
  const [externalName, setExternalName] = useState('');
  const [externalEmail, setExternalEmail] = useState('');

  // Search for recipients
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      searchRecipients(recipientSearch, activeRecipientTab);
    }, 300);
    return () => clearTimeout(timer);
  }, [recipientSearch, activeRecipientTab, open]);

  const searchRecipients = async (query: string, tab: string) => {
    setSearching(true);
    try {
      if (tab === 'contacts') {
        const data = await searchParticipantsWithEmail(query, 20);
        const results: Recipient[] = (data || []).map((p) => ({
          id: p.id,
          name: p.name || p.email || '',
          email: p.email || '',
          type: 'contact' as const,
          role: p.role,
        }));

        // Deduplicate by email
        const seen = new Set<string>();
        setSearchResults(
          results.filter((r) => {
            if (seen.has(r.email)) return false;
            seen.add(r.email);
            return true;
          })
        );
      } else if (tab === 'users') {
        const { data } = await listProfiles({ search: query || undefined, pageSize: 20, page: 1 });
        setSearchResults(
          (data || []).map((p) => ({
            id: p.user_id,
            name: p.full_name || p.email || '',
            email: p.email || '',
            type: 'user' as const,
          }))
        );
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error('Error searching recipients:', err);
    } finally {
      setSearching(false);
    }
  };

  const addRecipient = useCallback(
    (recipient: Recipient) => {
      if (selectedRecipients.some((r) => r.email === recipient.email)) return;
      setSelectedRecipients((prev) => [...prev, recipient]);
    },
    [selectedRecipients]
  );

  const removeRecipient = (email: string) => {
    setSelectedRecipients((prev) => prev.filter((r) => r.email !== email));
  };

  const addExternalRecipient = () => {
    if (!externalEmail.trim()) return;
    addRecipient({
      id: `ext-${Date.now()}`,
      name: externalName.trim() || externalEmail.trim(),
      email: externalEmail.trim(),
      type: 'external',
    });
    setExternalName('');
    setExternalEmail('');
  };

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds the 10MB limit`,
          variant: 'destructive',
        });
        continue;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setAttachments((prev) => [
          ...prev,
          { filename: file.name, content: base64, size: file.size },
        ]);
      };
      reader.readAsDataURL(file);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (selectedRecipients.length === 0) {
      toast({
        title: 'No recipients',
        description: 'Please add at least one recipient',
        variant: 'destructive',
      });
      return;
    }

    if (!body.trim()) {
      toast({
        title: 'Empty message',
        description: 'Please enter a message body',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await invokeSendMessage({
        message_type: messageType,
        subject,
        message_body: body,
        recipients: selectedRecipients.map((r) => ({
          name: r.name,
          email: r.email,
          type: r.type,
        })),
        attachments:
          messageType === 'email'
            ? attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                size: a.size,
              }))
            : [],
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: 'Message sent',
          description: `${messageType === 'email' ? 'Email' : 'Text message'} sent to ${selectedRecipients.length} recipient(s)`,
        });
        resetForm();
        onOpenChange(false);
      } else if (data?.status === 'pending') {
        toast({
          title: 'Message queued',
          description: data?.error || 'Message saved but delivery is pending — SMS is not yet configured.',
        });
        resetForm();
        onOpenChange(false);
      } else {
        toast({
          title: 'Send failed',
          description: data?.error || 'Failed to send message',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      console.error('Error sending message:', err);
      toast({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setSubject('');
    setBody('');
    setSelectedRecipients([]);
    setAttachments([]);
    setRecipientSearch('');
    setExternalName('');
    setExternalEmail('');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const getRoleIcon = (type: string, role?: string) => {
    if (type === 'external') return <Users className="h-3.5 w-3.5" />;
    if (type === 'user') return <UserCheck className="h-3.5 w-3.5" />;
    if (role === 'borrower') return <User className="h-3.5 w-3.5" />;
    if (role === 'lender') return <Building2 className="h-3.5 w-3.5" />;
    return <User className="h-3.5 w-3.5" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            New Message
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Message Type Toggle */}
          <div className="flex gap-2">
            <Button
              variant={messageType === 'email' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMessageType('email')}
              className="gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </Button>
            <Button
              variant={messageType === 'sms' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMessageType('sms')}
              className="gap-1.5"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Text Message
            </Button>
          </div>

          {/* Recipients */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">To</Label>

            {/* Selected Recipients */}
            {selectedRecipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-muted/30">
                {selectedRecipients.map((r) => (
                  <Badge
                    key={r.email}
                    variant="secondary"
                    className="gap-1 pr-1"
                  >
                    {getRoleIcon(r.type, r.role)}
                    <span className="max-w-[150px] truncate text-xs">
                      {r.name}
                    </span>
                    <button
                      onClick={() => removeRecipient(r.email)}
                      className="ml-1 hover:bg-background rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Recipient Search Tabs */}
            <Tabs
              value={activeRecipientTab}
              onValueChange={setActiveRecipientTab}
            >
              <TabsList className="h-8">
                <TabsTrigger value="contacts" className="text-xs px-3 h-6">
                  File Contacts
                </TabsTrigger>
                <TabsTrigger value="users" className="text-xs px-3 h-6">
                  App Users
                </TabsTrigger>
                <TabsTrigger value="external" className="text-xs px-3 h-6">
                  External
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contacts" className="mt-2 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search contacts by name or email..."
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <ScrollArea className="h-32 border rounded-md">
                  {searching ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      No contacts found
                    </div>
                  ) : (
                    <div className="p-1">
                      {searchResults.map((r) => {
                        const isSelected = selectedRecipients.some(
                          (s) => s.email === r.email
                        );
                        return (
                          <button
                            key={r.id}
                            onClick={() => addRecipient(r)}
                            disabled={isSelected}
                            className={cn(
                              'w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted flex items-center gap-2',
                              isSelected && 'opacity-50 cursor-not-allowed'
                            )}
                          >
                            {getRoleIcon(r.type, r.role)}
                            <span className="font-medium truncate">
                              {r.name}
                            </span>
                            <span className="text-muted-foreground truncate">
                              {r.email}
                            </span>
                            {r.role && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1 py-0 ml-auto"
                              >
                                {r.role}
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="users" className="mt-2 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search users by name or email..."
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <ScrollArea className="h-32 border rounded-md">
                  {searching ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      No users found
                    </div>
                  ) : (
                    <div className="p-1">
                      {searchResults.map((r) => {
                        const isSelected = selectedRecipients.some(
                          (s) => s.email === r.email
                        );
                        return (
                          <button
                            key={r.id}
                            onClick={() => addRecipient(r)}
                            disabled={isSelected}
                            className={cn(
                              'w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted flex items-center gap-2',
                              isSelected && 'opacity-50 cursor-not-allowed'
                            )}
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            <span className="font-medium truncate">
                              {r.name}
                            </span>
                            <span className="text-muted-foreground truncate">
                              {r.email}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="external" className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Name"
                    value={externalName}
                    onChange={(e) => setExternalName(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <EmailInput
                    placeholder="Email address"
                    value={externalEmail}
                    onValueChange={(v) => setExternalEmail(v)}
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addExternalRecipient}
                    disabled={!externalEmail.trim()}
                    className="h-8 text-xs whitespace-nowrap"
                  >
                    Add
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Subject (email only) */}
          {messageType === 'email' && (
            <div className="space-y-1">
              <Label className="text-xs font-medium">Subject</Label>
              <Input
                placeholder="Enter subject..."
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          {/* Message Body */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Message</Label>
            <Textarea
              placeholder="Type your message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[120px] text-xs resize-none"
            />
          </div>

          {/* Attachments (email only) */}
          {messageType === 'email' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5 h-7 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach Files
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileAttach}
                />
                {attachments.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {attachments.length} file(s) attached
                  </span>
                )}
              </div>

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((a, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="gap-1 pr-1 text-xs"
                    >
                      <Paperclip className="h-3 w-3" />
                      <span className="max-w-[120px] truncate">
                        {a.filename}
                      </span>
                      <span className="text-muted-foreground">
                        ({formatFileSize(a.size)})
                      </span>
                      <button
                        onClick={() => removeAttachment(i)}
                        className="ml-1 hover:bg-background rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-xs text-muted-foreground">
            {selectedRecipients.length} recipient(s)
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={
                sending ||
                selectedRecipients.length === 0 ||
                !body.trim()
              }
              className="gap-1.5"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
