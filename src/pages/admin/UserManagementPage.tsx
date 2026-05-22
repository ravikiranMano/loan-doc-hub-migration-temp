import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useToast } from '@/hooks/use-toast';
import {
  listProfilesForAdmin,
  listUserRoles,
  listUserPermissionLevels,
  assignUserRoleAndPermission,
} from '@/services/admin/users.service';
import { Plus, Search, Users, Shield, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserWithRole {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'csr' | null;
  created_at: string;
  permission_level: string | null;
}

export const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithRole | null>(null);
  const [newRole, setNewRole] = useState<string>('');
  const [newPermissionLevel, setNewPermissionLevel] = useState<string>('full');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      // Fetch profiles
      const profiles = await listProfilesForAdmin();
      const roles = await listUserRoles();
      const permLevels = await listUserPermissionLevels();

      // Combine data
      const usersWithRoles: UserWithRole[] = (profiles || []).map((profile) => {
        const userRole = roles?.find((r) => r.user_id === profile.user_id);
        const userPermLevel = (permLevels as any[] || []).find((p: any) => p.user_id === profile.user_id);
        return {
          id: profile.user_id,
          email: profile.email || '',
          full_name: profile.full_name,
          role: userRole?.role as 'admin' | 'csr' | null,
          created_at: profile.created_at,
          permission_level: userPermLevel?.permission_level || null,
        };
      });

      setUsers(usersWithRoles);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({
        title: 'Error',
        description: 'Failed to load users',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRole = async () => {
    if (!selectedUser || !newRole) return;

    setSaving(true);
    try {
      await assignUserRoleAndPermission({
        p_user_id: selectedUser.id,
        p_role: newRole as 'admin' | 'csr',
        p_permission_level: newRole === 'csr' ? newPermissionLevel : 'full',
      });

      toast({
        title: 'Role assigned',
        description: `${selectedUser.email} has been assigned the ${newRole.toUpperCase()} role${newRole === 'csr' ? ` with ${newPermissionLevel.replace('_', '-')} permission level` : ''}.`,
      });

      setIsDialogOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error assigning role:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to assign role',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-muted-foreground mt-1">Manage user roles and permissions</p>
        </div>
      </div>

      <div className="section-card mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="section-card text-center py-12">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No users found</h3>
          <p className="text-muted-foreground">
            Users will appear here after they sign up
          </p>
        </div>
      ) : (
        <div className="section-card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">User</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Role</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Permission Level</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Joined</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-medium text-primary">
                            {user.full_name?.[0] || user.email[0].toUpperCase()}
                          </span>
                        </div>
                        <span className="font-medium text-foreground">
                          {user.full_name || 'No name'}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-muted-foreground">{user.email}</td>
                    <td className="py-4 px-4">
                      {user.role ? (
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                          user.role === 'admin' 
                            ? 'bg-primary/10 text-primary' 
                            : 'bg-success/10 text-success'
                        )}>
                          <Shield className="h-3 w-3" />
                          {user.role.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">No role</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {user.role === 'csr' ? (
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                          user.permission_level === 'view_only'
                            ? 'bg-destructive/10 text-destructive'
                            : user.permission_level === 'limited'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-success/10 text-success'
                        )}>
                          {(user.permission_level || 'full').replace('_', '-').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-sm text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedUser(user);
                          setNewRole(user.role || '');
                          setNewPermissionLevel(user.permission_level || 'full');
                          setIsDialogOpen(true);
                        }}
                      >
                        {user.role ? 'Change Role' : 'Assign Role'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Role</DialogTitle>
            <DialogDescription>
              {selectedUser ? `Assign a role to ${selectedUser.email}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label htmlFor="role">Role</Label>
              <Select
                value={newRole}
                onValueChange={(val) => {
                  setNewRole(val);
                  if (val !== 'csr') setNewPermissionLevel('full');
                }}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="csr">CSR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newRole === 'csr' && (
              <div>
                <Label htmlFor="permission_level">Permission Level</Label>
                <Select value={newPermissionLevel} onValueChange={setNewPermissionLevel}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full — Can edit all forms</SelectItem>
                    <SelectItem value="limited">Limited — Edit only allowed forms</SelectItem>
                    <SelectItem value="view_only">View-Only — Cannot edit any form</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssignRole} disabled={saving || !newRole}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Assign Role'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagementPage;
