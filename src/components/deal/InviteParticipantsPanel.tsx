import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  listParticipantsByDealOrdered,
  insertParticipant,
  updateParticipant,
  deleteParticipant,
} from '@/services/deals/participants.service';
import { getContactsByIds } from '@/services/contacts/contacts.service';
import { subscribeToChanges } from '@/services/realtime';
import { sendParticipantInvite } from '@/services/deals/participants-invite.service';
import { useAuth } from '@/contexts/AuthContext';
import { createMagicLink, revokeMagicLink, getMagicLinksForParticipant } from '@/lib/magicLink';
import { logParticipantInvited, logParticipantRemoved, logAccessRevoked, logParticipantStatusReset } from '@/hooks/useActivityLog';
import { getRoleDisplayName, getRoleBadgeClasses } from '@/lib/accessControl';
import { formatDistanceToNow, format } from 'date-fns';
import { 
  UserPlus, 
  Loader2, 
  Mail, 
  Link2, 
  Users,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  Trash2,
  RefreshCw,
  ShieldOff,
  RotateCcw,
  ArrowRight,
  Calendar,
  ExternalLink,
  XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AppRole, ParticipantStatus } from '@/types';

interface Participant {
  id: string;
  deal_id: string;
  role: AppRole;
  user_id: string | null;
  access_method: 'login' | 'magic_link';
  sequence_order: number | null;
  status: ParticipantStatus;
  invited_at: string;
  completed_at: string | null;
  revoked_at: string | null;
  email: string | null;
  name: string | null;
  contact_id: string | null;
  contact_id_display: string;
}

interface MagicLinkInfo {
  id: string;
  token: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
}

interface InviteParticipantsPanelProps {
  dealId: string;
  dealNumber: string;
  disabled?: boolean;
}

const EXTERNAL_ROLES: { value: AppRole; label: string }[] = [
  { value: 'borrower', label: 'Borrower' },
  { value: 'broker', label: 'Broker' },
  { value: 'lender', label: 'Lender' },
];

const statusConfig: Record<ParticipantStatus, { label: string; color: string; icon: React.ElementType }> = {
  invited: { label: 'Invited', color: 'bg-muted text-muted-foreground', icon: Clock },
  in_progress: { label: 'In Progress', color: 'bg-primary/10 text-primary', icon: Users },
  completed: { label: 'Completed', color: 'bg-success/10 text-success', icon: CheckCircle2 },
  expired: { label: 'Expired', color: 'bg-destructive/10 text-destructive', icon: AlertCircle },
};

export const InviteParticipantsPanel: React.FC<InviteParticipantsPanelProps> = ({
  dealId,
  dealNumber,
  disabled = false,
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [magicLinks, setMagicLinks] = useState<Record<string, MagicLinkInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Confirmation dialogs
  const [revokeConfirm, setRevokeConfirm] = useState<Participant | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<Participant | null>(null);

  // Form state
  const [selectedRole, setSelectedRole] = useState<AppRole>('borrower');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [accessMethod, setAccessMethod] = useState<'login' | 'magic_link'>('magic_link');
  const [entryMode, setEntryMode] = useState<'parallel' | 'sequential'>('parallel');
  const [sequenceOrder, setSequenceOrder] = useState<number>(1);

  const fetchParticipants = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await listParticipantsByDealOrdered(dealId);

      // Fetch contact_id display values for linked participants
      const contactIds = rows
        .map((p) => p.contact_id)
        .filter((id): id is string => !!id);

      let contactIdMap: Record<string, string> = {};
      if (contactIds.length > 0) {
        const contacts = await getContactsByIds(contactIds, 'id, contact_id');
        if (contacts.length) {
          for (const c of contacts) {
            contactIdMap[c.id] = c.contact_id || '';
          }
        }
      }

      setParticipants(
        rows.map((p) => ({
          ...p,
          contact_id_display: p.contact_id ? contactIdMap[p.contact_id] || '' : '',
        })) as Participant[]
      );

      // Fetch magic links for each participant
      const linksByParticipant: Record<string, MagicLinkInfo[]> = {};
      for (const p of rows) {
        if (p.access_method === 'magic_link') {
          const result = await getMagicLinksForParticipant(p.id);
          if (result.data) {
            linksByParticipant[p.id] = result.data.map(link => ({
              id: link.id,
              token: link.token,
              expires_at: link.expires_at,
              max_uses: link.max_uses,
              used_count: link.used_count,
            }));
          }
        }
      }
      setMagicLinks(linksByParticipant);
    } catch (error) {
      console.error('Error fetching participants:', error);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  // Subscribe to realtime updates
  useEffect(() => {
    const { unsubscribe } = subscribeToChanges({
      channelName: `deal-participants-overview-${dealId}`,
      table: 'deal_participants',
      filter: `deal_id=eq.${dealId}`,
      onChange: (payload) => {
        fetchParticipants();

        if (payload?.eventType === 'UPDATE' && payload.new) {
          const newRecord = payload.new as unknown as Participant;
          const oldRecord = payload.old as unknown as Participant;

          if (oldRecord.status !== newRecord.status) {
            if (newRecord.status === 'completed') {
              toast({
                title: 'Participant Completed',
                description: `${getRoleDisplayName(newRecord.role)} has completed their section`,
              });
            } else if (newRecord.status === 'in_progress') {
              toast({
                title: 'Participant Active',
                description: `${getRoleDisplayName(newRecord.role)} has started entering data`,
              });
            }
          }
        }
      },
    });

    return unsubscribe;
  }, [dealId, fetchParticipants, toast]);

  const getAvailableRoles = () => {
    const usedRoles = new Set(participants.map(p => p.role));
    return EXTERNAL_ROLES.filter(r => !usedRoles.has(r.value));
  };

  const handleInvite = async () => {
    if (!email || !selectedRole) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      // 1. Create deal participant with email and name
      const participantData = {
        deal_id: dealId,
        role: selectedRole,
        access_method: accessMethod,
        sequence_order: entryMode === 'sequential' ? sequenceOrder : null,
        status: 'invited' as ParticipantStatus,
        email: email,
        name: name || null,
      };

      const participant = await insertParticipant(participantData);

      // 2. Create magic link if applicable
      let magicLinkUrl: string | null = null;
      if (accessMethod === 'magic_link' && user?.id) {
        const { url, error: magicError } = await createMagicLink(
          participant.id,
          user.id
        );
        if (magicError) {
          console.error('Error creating magic link:', magicError);
        } else {
          magicLinkUrl = url;
        }
      }

      // 3. Send invite email
      const { error: emailError } = await sendParticipantInvite(dealId, {
        participantId: participant.id,
        email,
        name: name || undefined,
        accessMethod,
        magicLinkUrl,
        dealNumber,
        role: selectedRole,
      });

      if (emailError) {
        console.error('Error sending invite:', emailError);
        toast({
          title: 'Warning',
          description: 'Participant added but email could not be sent',
          variant: 'default',
        });
      } else {
        toast({
          title: 'Invite Sent',
          description: `Invitation sent to ${email}`,
        });
      }

      // 4. Log activity
      await logParticipantInvited(dealId, {
        role: selectedRole,
        email,
        accessMethod,
      });

      // Reset form and refresh
      setIsDialogOpen(false);
      resetForm();
      fetchParticipants();

    } catch (error: any) {
      console.error('Error inviting participant:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to invite participant',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleRemoveParticipant = async (participant: Participant) => {
    setActionLoading(participant.id);
    try {
      await deleteParticipant(participant.id);

      await logParticipantRemoved(dealId, { role: participant.role });
      toast({ title: 'Participant removed' });
      fetchParticipants();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to remove participant',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
      setRemoveConfirm(null);
    }
  };

  const handleResendInvite = async (participant: Participant) => {
    if (!participant.email) {
      toast({
        title: 'Cannot resend',
        description: 'No email address stored for this participant',
        variant: 'destructive',
      });
      return;
    }

    setActionLoading(participant.id);
    try {
      let magicLinkUrl: string | null = null;
      
      // Create new magic link if using magic link access
      if (participant.access_method === 'magic_link' && user?.id) {
        const { url, error: magicError } = await createMagicLink(
          participant.id,
          user.id
        );
        if (magicError) {
          console.error('Error creating magic link:', magicError);
        } else {
          magicLinkUrl = url;
        }
      }

      // Send invite email
      const { error: emailError } = await sendParticipantInvite(dealId, {
        participantId: participant.id,
        email: participant.email,
        name: participant.name || undefined,
        accessMethod: participant.access_method as 'login' | 'magic_link',
        magicLinkUrl,
        dealNumber,
        role: participant.role,
      });

      if (emailError) throw emailError;

      toast({
        title: 'Invite Resent',
        description: `New invitation sent to ${participant.email}`,
      });
      
      fetchParticipants();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to resend invite',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeAccess = async (participant: Participant) => {
    setActionLoading(participant.id);
    try {
      // Revoke all magic links for this participant
      const links = magicLinks[participant.id] || [];
      for (const link of links) {
        await revokeMagicLink(link.id);
      }

      // Update participant status
      await updateParticipant(participant.id, {
        revoked_at: new Date().toISOString(),
        status: 'expired' as ParticipantStatus,
      });

      // Log the revocation
      await logAccessRevoked(dealId, {
        role: participant.role,
        participantId: participant.id,
        email: participant.email || undefined,
      });

      toast({
        title: 'Access Revoked',
        description: `${getRoleDisplayName(participant.role)}'s access has been revoked`,
      });
      
      fetchParticipants();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to revoke access',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
      setRevokeConfirm(null);
    }
  };

  const handleResetStatus = async (participant: Participant) => {
    setActionLoading(participant.id);
    try {
      const previousStatus = participant.status;
      
      await updateParticipant(participant.id, {
        status: 'invited' as ParticipantStatus,
        completed_at: null,
        revoked_at: null,
      });

      // Log the status reset
      await logParticipantStatusReset(dealId, {
        role: participant.role,
        participantId: participant.id,
        previousStatus,
      });

      toast({
        title: 'Status Reset',
        description: `${getRoleDisplayName(participant.role)} status reset to Invited`,
      });
      
      fetchParticipants();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to reset status',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const resetForm = () => {
    const available = getAvailableRoles();
    setSelectedRole(available[0]?.value || 'borrower');
    setEmail('');
    setName('');
    setAccessMethod('magic_link');
    setEntryMode('parallel');
    setSequenceOrder(participants.length + 1);
  };

  // Calculate entry mode from existing participants
  const isSequentialMode = participants.some(p => p.sequence_order !== null);
  const completedCount = participants.filter(p => p.status === 'completed').length;
  const totalParticipants = participants.length;
  const progressPercent = totalParticipants > 0 ? Math.round((completedCount / totalParticipants) * 100) : 0;

  const availableRoles = getAvailableRoles();
  const canAddMore = availableRoles.length > 0;

  const getMagicLinkStatus = (participant: Participant): { label: string; expired: boolean } | null => {
    if (participant.access_method !== 'magic_link') return null;
    
    const links = magicLinks[participant.id] || [];
    const validLink = links.find(l => 
      new Date(l.expires_at) > new Date() && l.used_count < l.max_uses
    );
    
    if (validLink) {
      return { 
        label: `Expires ${formatDistanceToNow(new Date(validLink.expires_at), { addSuffix: true })}`,
        expired: false,
      };
    }
    
    if (links.length > 0) {
      return { label: 'Link expired', expired: true };
    }
    
    return null;
  };

  return (
    <TooltipProvider>
      <div className="section-card">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold text-foreground">Participants</h3>
              {totalParticipants > 0 && (
                <p className="text-xs text-muted-foreground">
                  {isSequentialMode ? 'Sequential' : 'Parallel'} entry • {completedCount}/{totalParticipants} completed
                </p>
              )}
            </div>
          </div>
          {canAddMore && !disabled && (
            <Button 
              size="sm" 
              onClick={() => {
                resetForm();
                setIsDialogOpen(true);
              }}
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Invite
            </Button>
          )}
        </div>

        {/* Progress bar for participants */}
        {totalParticipants > 0 && (
          <div className="mb-4">
            <Progress value={progressPercent} className="h-1.5" />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : participants.length === 0 ? (
          <div className="text-center py-8">
            <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No participants invited yet</p>
            {canAddMore && !disabled && (
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-4 gap-2"
                onClick={() => {
                  resetForm();
                  setIsDialogOpen(true);
                }}
              >
                <UserPlus className="h-4 w-4" />
                Invite First Participant
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {participants.map((participant, index) => {
              const StatusIcon = statusConfig[participant.status].icon;
              const isRevoked = !!participant.revoked_at;
              const linkStatus = getMagicLinkStatus(participant);
              const isLoading = actionLoading === participant.id;
              
              return (
                <div
                  key={participant.id}
                  className={cn(
                    "p-4 rounded-lg border transition-colors",
                    isRevoked 
                      ? "border-destructive/30 bg-destructive/5" 
                      : participant.status === 'completed'
                        ? "border-success/30 bg-success/5"
                        : "border-border"
                  )}
                >
                  <div className="flex items-start justify-between gap-3 overflow-hidden">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Role avatar with sequence number */}
                      <div className="relative">
                        <div className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium',
                          getRoleBadgeClasses(participant.role)
                        )}>
                          {participant.role.charAt(0).toUpperCase()}
                        </div>
                        {participant.sequence_order && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">
                            {participant.sequence_order}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        {/* Name and role */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-foreground truncate">
                            {participant.name
                              ? participant.contact_id_display
                                ? `${participant.name} - ${participant.contact_id_display}`
                                : participant.name
                              : getRoleDisplayName(participant.role)}
                          </span>
                          <Badge variant="outline" className="text-xs gap-1 shrink-0">
                            {participant.access_method === 'magic_link' ? (
                              <><Link2 className="h-3 w-3" /> Magic Link</>
                            ) : (
                              <><Mail className="h-3 w-3" /> Login</>
                            )}
                          </Badge>
                        </div>
                        
                        {/* Email */}
                        {participant.email && (
                          <p className="text-sm text-muted-foreground truncate mt-0.5">
                            {participant.email}
                          </p>
                        )}
                        
                        {/* Status badges */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge 
                            variant="secondary" 
                            className={cn('text-xs gap-1', statusConfig[participant.status].color)}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {statusConfig[participant.status].label}
                          </Badge>
                          
                          {isRevoked && (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <ShieldOff className="h-3 w-3" />
                              Revoked
                            </Badge>
                          )}
                          
                          {linkStatus && (
                            <Badge 
                              variant="outline" 
                              className={cn(
                                'text-xs',
                                linkStatus.expired && 'text-destructive border-destructive/50'
                              )}
                            >
                              {linkStatus.label}
                            </Badge>
                          )}
                        </div>
                        
                        {/* Timestamps */}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Invited {formatDistanceToNow(new Date(participant.invited_at), { addSuffix: true })}
                            </TooltipTrigger>
                            <TooltipContent>
                              {format(new Date(participant.invited_at), 'PPpp')}
                            </TooltipContent>
                          </Tooltip>
                          
                          {participant.completed_at && (
                            <Tooltip>
                              <TooltipTrigger className="flex items-center gap-1 text-success">
                                <CheckCircle2 className="h-3 w-3" />
                                Completed {formatDistanceToNow(new Date(participant.completed_at), { addSuffix: true })}
                              </TooltipTrigger>
                              <TooltipContent>
                                {format(new Date(participant.completed_at), 'PPpp')}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions dropdown - hidden for read-only users */}
                    {!disabled && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={isLoading}>
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {participant.email && participant.status !== 'completed' && !isRevoked && (
                          <DropdownMenuItem onClick={() => handleResendInvite(participant)}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Resend Invite
                          </DropdownMenuItem>
                        )}
                        
                        {participant.status !== 'completed' && !isRevoked && (
                          <DropdownMenuItem onClick={() => setRevokeConfirm(participant)}>
                            <ShieldOff className="h-4 w-4 mr-2" />
                            Revoke Access
                          </DropdownMenuItem>
                        )}
                        
                        {(participant.status === 'completed' || participant.status === 'expired' || isRevoked) && (
                          <DropdownMenuItem onClick={() => handleResetStatus(participant)}>
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset Status
                          </DropdownMenuItem>
                        )}
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem 
                          onClick={() => setRemoveConfirm(participant)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                  </div>
                  
                  {/* Sequential mode: show arrow to next */}
                  {isSequentialMode && participant.status === 'completed' && index < participants.length - 1 && (
                    <div className="flex justify-center mt-2 text-muted-foreground">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Invite Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Invite Participant</DialogTitle>
              <DialogDescription>
                Invite an external participant to this deal
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Role Selection */}
              <div className="space-y-2">
                <Label>Role *</Label>
                <Select 
                  value={selectedRole} 
                  onValueChange={(v) => setSelectedRole(v as AppRole)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <EmailInput
                  value={email}
                  onValueChange={(v) => setEmail(v)}
                  placeholder="participant@example.com"
                />
              </div>

              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">Name (Optional)</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>

              {/* Access Method */}
              <div className="space-y-3">
                <Label>Access Method</Label>
                <RadioGroup 
                  value={accessMethod} 
                  onValueChange={(v) => setAccessMethod(v as 'login' | 'magic_link')}
                  className="grid grid-cols-2 gap-3"
                >
                  <div className={cn(
                    'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                    accessMethod === 'magic_link' 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/50'
                  )}>
                    <RadioGroupItem value="magic_link" id="magic_link" />
                    <Label htmlFor="magic_link" className="flex items-center gap-2 cursor-pointer">
                      <Link2 className="h-4 w-4" />
                      Magic Link
                    </Label>
                  </div>
                  <div className={cn(
                    'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                    accessMethod === 'login' 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/50'
                  )}>
                    <RadioGroupItem value="login" id="login" />
                    <Label htmlFor="login" className="flex items-center gap-2 cursor-pointer">
                      <Mail className="h-4 w-4" />
                      Login
                    </Label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  {accessMethod === 'magic_link' 
                    ? 'Secure one-time link for quick access without registration'
                    : 'User must register/login to access the deal'
                  }
                </p>
              </div>

              {/* Entry Mode */}
              <div className="space-y-3">
                <Label>Entry Mode</Label>
                <RadioGroup 
                  value={entryMode} 
                  onValueChange={(v) => setEntryMode(v as 'parallel' | 'sequential')}
                  className="grid grid-cols-2 gap-3"
                >
                  <div className={cn(
                    'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                    entryMode === 'parallel' 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/50'
                  )}>
                    <RadioGroupItem value="parallel" id="parallel" />
                    <Label htmlFor="parallel" className="cursor-pointer">Parallel</Label>
                  </div>
                  <div className={cn(
                    'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                    entryMode === 'sequential' 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/50'
                  )}>
                    <RadioGroupItem value="sequential" id="sequential" />
                    <Label htmlFor="sequential" className="cursor-pointer">Sequential</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Sequence Order */}
              {entryMode === 'sequential' && (
                <div className="space-y-2">
                  <Label htmlFor="order">Sequence Order</Label>
                  <Input
                    id="order"
                    type="number"
                    min="1"
                    value={sequenceOrder}
                    onChange={(e) => setSequenceOrder(parseInt(e.target.value) || 1)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Order in which this participant should complete their tasks
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={sending} className="gap-2">
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send Invite
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revoke Confirmation Dialog */}
        <AlertDialog open={!!revokeConfirm} onOpenChange={() => setRevokeConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke Access</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to revoke access for {revokeConfirm?.name || getRoleDisplayName(revokeConfirm?.role || 'borrower')}? 
                This will invalidate any existing magic links and prevent them from accessing the deal.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => revokeConfirm && handleRevokeAccess(revokeConfirm)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Revoke Access
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Remove Confirmation Dialog */}
        <AlertDialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Participant</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove {removeConfirm?.name || getRoleDisplayName(removeConfirm?.role || 'borrower')}? 
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => removeConfirm && handleRemoveParticipant(removeConfirm)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default InviteParticipantsPanel;
