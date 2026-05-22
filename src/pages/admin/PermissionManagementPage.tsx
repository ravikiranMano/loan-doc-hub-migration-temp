import React, { useEffect } from 'react';
import { useFormPermissionsAdmin } from '@/hooks/useFormPermissions';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Lock, Loader2, ShieldCheck } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const FORM_LABELS: Record<string, string> = {
  borrower: 'Borrower',
  co_borrower: 'Co-Borrower',
  property: 'Property',
  loan_terms: 'Loan Terms',
  lender: 'Lender',
  broker: 'Broker',
  charges: 'Charges',
  notes: 'Notes / Conversation Log',
  insurance: 'Insurance',
  liens: 'Liens',
  origination: 'Origination',
  trust_ledger: 'Trust Ledger',
  participants: 'Participants',
};

const PermissionManagementPage: React.FC = () => {
  const {
    csrUsers,
    userPermissions,
    loading,
    permLoading,
    fetchUserPermissions,
    setSelectedUserId: trackSelectedUser,
    updatePermission,
  } = useFormPermissionsAdmin();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = React.useState<string>('');

  const handleUserChange = (userId: string) => {
    setSelectedUserId(userId);
    trackSelectedUser(userId);
  };

  // When a user is selected, fetch their permissions (deduped in hook)
  useEffect(() => {
    if (selectedUserId) {
      void fetchUserPermissions(selectedUserId);
    }
  }, [selectedUserId, fetchUserPermissions]);

  const handleToggle = async (id: string, currentMode: string) => {
    const newMode = currentMode === 'editable' ? 'view_only' : 'editable';
    try {
      await updatePermission(id, newMode as 'editable' | 'view_only');
      toast({
        title: 'Permission updated',
        description: `Form access changed to ${newMode === 'editable' ? 'Editable' : 'Read Only'}`,
      });
      // Refresh permissions for selected user
      if (selectedUserId) {
        fetchUserPermissions(selectedUserId);
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to update permission',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Permission Management</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Assign form-level permissions for individual CSR users
        </p>
      </div>

      {/* CSR User Selector */}
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-foreground">Select CSR User:</span>
        <Select value={selectedUserId} onValueChange={handleUserChange}>
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {csrUsers.map(u => (
              <SelectItem key={u.user_id} value={u.user_id}>
                {u.full_name || u.email || u.user_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {csrUsers.length === 0 && !loading && (
          <span className="text-sm text-muted-foreground">No CSR users found</span>
        )}
      </div>

      {/* Permissions Grid */}
      {selectedUserId && (
        <div className="section-card">
          {permLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Form Name</TableHead>
                  <TableHead className="w-[180px]">Current Access</TableHead>
                  <TableHead className="w-[150px]">Editable / Read Only</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userPermissions.map((perm) => (
                  <TableRow key={perm.id}>
                    <TableCell className="font-medium">
                      {FORM_LABELS[perm.form_key] || perm.form_key}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={perm.access_mode === 'editable' ? 'default' : 'secondary'}
                        className="gap-1"
                      >
                        {perm.access_mode === 'editable' ? (
                          <>
                            <ShieldCheck className="h-3 w-3" />
                            Editable
                          </>
                        ) : (
                          <>
                            <Lock className="h-3 w-3" />
                            Read Only
                          </>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={perm.access_mode === 'editable'}
                        onCheckedChange={() => handleToggle(perm.id, perm.access_mode)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {userPermissions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No permissions configured
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {!selectedUserId && (
        <div className="section-card flex items-center justify-center py-12">
          <p className="text-muted-foreground">Select a CSR user above to manage their form permissions</p>
        </div>
      )}
    </div>
  );
};

export default PermissionManagementPage;
