import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { 
  Search, 
  Users, 
  Loader2,
  Edit,
  Phone,
  Building,
  FileText,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  license_number: string | null;
  user_type: string | null;
  created_at: string;
}

interface UserRole {
  user_id: string;
  role: string;
}

type UserTypeFilter = 'all' | 'internal' | 'borrower' | 'broker' | 'lender';

const PAGE_SIZE = 20;

export const UsersPage: React.FC = () => {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<UserTypeFilter>('all');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  
  // Edit modal state
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: '',
    phone: '',
    company: '',
    license_number: '',
    user_type: 'internal' as string,
  });

  useEffect(() => {
    fetchProfiles();
  }, [page, typeFilter]);

  const fetchProfiles = async () => {
    try {
      setLoading(true);

      // Build query
      let query = supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply type filter
      if (typeFilter !== 'all') {
        query = query.eq('user_type', typeFilter);
      }

      // Apply pagination
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      setProfiles(data || []);
      setTotalCount(count || 0);

      // Fetch roles for these users
      if (data && data.length > 0) {
        const userIds = data.map(p => p.user_id);
        const { data: rolesData } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('user_id', userIds);

        const rolesMap: Record<string, string> = {};
        (rolesData || []).forEach((r: UserRole) => {
          rolesMap[r.user_id] = r.role;
        });
        setUserRoles(rolesMap);
      }
    } catch (error: any) {
      console.error('Error fetching profiles:', error);
      toast({
        title: 'Error',
        description: 'Failed to load users',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (profile: Profile) => {
    setEditingProfile(profile);
    setEditForm({
      full_name: profile.full_name || '',
      phone: profile.phone || '',
      company: profile.company || '',
      license_number: profile.license_number || '',
      user_type: profile.user_type || 'internal',
    });
  };

  const handleSave = async () => {
    if (!editingProfile) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editForm.full_name || null,
          phone: editForm.phone || null,
          company: editForm.company || null,
          license_number: editForm.license_number || null,
          user_type: editForm.user_type,
        })
        .eq('id', editingProfile.id);

      if (error) throw error;

      toast({
        title: 'Saved',
        description: 'User profile updated successfully',
      });

      setEditingProfile(null);
      fetchProfiles();
    } catch (error: any) {
      console.error('Error saving profile:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save profile',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const filteredProfiles = profiles.filter(profile => {
    const searchLower = searchQuery.toLowerCase();
    return (
      (profile.full_name?.toLowerCase() || '').includes(searchLower) ||
      (profile.email?.toLowerCase() || '').includes(searchLower) ||
      (profile.company?.toLowerCase() || '').includes(searchLower)
    );
  });

  const getUserTypeBadge = (userType: string | null, role: string | undefined) => {
    const type = userType || role || 'internal';
    switch (type) {
      case 'borrower':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Borrower</Badge>;
      case 'broker':
        return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Broker</Badge>;
      case 'lender':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Lender</Badge>;
      case 'csr':
        return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">CSR</Badge>;
      case 'admin':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Admin</Badge>;
      default:
        return <Badge variant="secondary">Internal</Badge>;
    }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-muted-foreground mt-1">
            Manage borrowers, brokers, lenders, and internal users
          </p>
        </div>
      </div>

      <div className="section-card mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select 
            value={typeFilter} 
            onValueChange={(v) => { setTypeFilter(v as UserTypeFilter); setPage(1); }}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="borrower">Borrowers</SelectItem>
              <SelectItem value="broker">Brokers</SelectItem>
              <SelectItem value="lender">Lenders</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="section-card text-center py-12">
          <Loader2 className="h-8 w-8 mx-auto text-muted-foreground animate-spin mb-4" />
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="section-card text-center py-16">
          <Users className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">No Users Found</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            {searchQuery 
              ? 'No users match your search criteria.' 
              : 'No users have been added yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="section-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="font-medium">
                      {profile.full_name || '—'}
                    </TableCell>
                    <TableCell>{profile.email || '—'}</TableCell>
                    <TableCell>
                      {getUserTypeBadge(profile.user_type, userRoles[profile.user_id])}
                    </TableCell>
                    <TableCell>
                      {profile.phone ? (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {profile.phone}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {profile.company ? (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Building className="h-3 w-3" />
                          {profile.company}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(profile)}
                        className="gap-1"
                      >
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} users
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingProfile} onOpenChange={(open) => !open && setEditingProfile(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit User Profile</DialogTitle>
            <DialogDescription>
              Update user information. Click save when you're done.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                value={editForm.full_name}
                onChange={(e) => setEditForm(f => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  value={editForm.phone}
                  onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  className="pl-10"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="company">Company</Label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="company"
                  value={editForm.company}
                  onChange={(e) => setEditForm(f => ({ ...f, company: e.target.value }))}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="license_number">License Number</Label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="license_number"
                  value={editForm.license_number}
                  onChange={(e) => setEditForm(f => ({ ...f, license_number: e.target.value }))}
                  className="pl-10"
                  placeholder="BR-123456"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user_type">User Type</Label>
              <Select 
                value={editForm.user_type} 
                onValueChange={(v) => setEditForm(f => ({ ...f, user_type: v }))}
              >
                <SelectTrigger id="user_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal</SelectItem>
                  <SelectItem value="borrower">Borrower</SelectItem>
                  <SelectItem value="broker">Broker</SelectItem>
                  <SelectItem value="lender">Lender</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProfile(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersPage;
