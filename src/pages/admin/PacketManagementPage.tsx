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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Plus, 
  Search, 
  Package, 
  Loader2, 
  MoreHorizontal,
  Pencil,
  Trash2,
  FileText,
  GripVertical,
  X
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Packet {
  id: string;
  name: string;
  state: string;
  product_type: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  all_states: boolean;
  states: string[];
}

interface Template {
  id: string;
  name: string;
  state: string;
  product_type: string;
  version: number;
}

interface PacketTemplate {
  id: string;
  template_id: string;
  display_order: number;
  is_required: boolean;
  template?: Template;
}

import { US_STATES } from '@/lib/usStates';

const PRODUCT_TYPES = [
  'Conventional', 'FHA', 'VA', 'USDA', 'Jumbo', 'Reverse Mortgage', 'HELOC', 'Construction'
];

export const PacketManagementPage: React.FC = () => {
  const [packets, setPackets] = useState<Packet[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [editingPacket, setEditingPacket] = useState<Packet | null>(null);
  const [selectedPacket, setSelectedPacket] = useState<Packet | null>(null);
  const [packetTemplates, setPacketTemplates] = useState<PacketTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    state: '',
    product_type: '',
    description: '',
    is_active: true,
    all_states: false,
    states: [] as string[],
  });

  const [stateSearchQuery, setStateSearchQuery] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [packetsRes, templatesRes] = await Promise.all([
        supabase.from('packets').select('*').order('name'),
        supabase.from('templates').select('*').eq('is_active', true).order('name'),
      ]);

      if (packetsRes.error) throw packetsRes.error;
      if (templatesRes.error) throw templatesRes.error;

      // Map packets with new fields, falling back to old state field
      const mappedPackets = (packetsRes.data || []).map((p: any) => ({
        ...p,
        all_states: p.all_states || false,
        states: p.states && p.states.length > 0 ? p.states : (p.state && p.state !== 'TBD' ? [p.state] : []),
      }));

      setPackets(mappedPackets);
      setTemplates(templatesRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPacketTemplates = async (packetId: string) => {
    try {
      const { data, error } = await supabase
        .from('packet_templates')
        .select('*, templates(*)')
        .eq('packet_id', packetId)
        .order('display_order');

      if (error) throw error;

      setPacketTemplates(
        (data || []).map((pt: any) => ({
          id: pt.id,
          template_id: pt.template_id,
          display_order: pt.display_order,
          is_required: pt.is_required,
          template: pt.templates,
        }))
      );
    } catch (error) {
      console.error('Error fetching packet templates:', error);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name) {
      toast({
        title: 'Validation error',
        description: 'Please fill in the packet name',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        state: 'TBD',
        product_type: 'TBD',
        description: formData.description || null,
        is_active: formData.is_active,
        all_states: false,
        states: [] as string[],
      };

      if (editingPacket) {
        const { error } = await supabase
          .from('packets')
          .update(payload)
          .eq('id', editingPacket.id);

        if (error) throw error;
        toast({ title: 'Packet updated successfully' });
      } else {
        const { error } = await supabase.from('packets').insert(payload);

        if (error) throw error;
        toast({ title: 'Packet created successfully' });
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save packet',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (packet: Packet) => {
    setEditingPacket(packet);
    setFormData({
      name: packet.name,
      state: packet.state,
      product_type: packet.product_type,
      description: packet.description || '',
      is_active: packet.is_active,
      all_states: packet.all_states,
      states: packet.states || [],
    });
    setIsDialogOpen(true);
  };

  const handleManageTemplates = async (packet: Packet) => {
    setSelectedPacket(packet);
    await fetchPacketTemplates(packet.id);
    setIsTemplateDialogOpen(true);
  };

  const handleAddTemplate = async (templateId: string) => {
    if (!selectedPacket) return;

    try {
      const maxOrder = packetTemplates.length > 0
        ? Math.max(...packetTemplates.map((pt) => pt.display_order))
        : -1;

      const { error } = await supabase.from('packet_templates').insert({
        packet_id: selectedPacket.id,
        template_id: templateId,
        display_order: maxOrder + 1,
        is_required: true,
      });

      if (error) throw error;
      await fetchPacketTemplates(selectedPacket.id);
      toast({ title: 'Template added to packet' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add template',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveTemplate = async (packetTemplateId: string) => {
    try {
      const { error } = await supabase
        .from('packet_templates')
        .delete()
        .eq('id', packetTemplateId);

      if (error) throw error;
      if (selectedPacket) {
        await fetchPacketTemplates(selectedPacket.id);
      }
      toast({ title: 'Template removed from packet' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to remove template',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (packet: Packet) => {
    if (!confirm(`Are you sure you want to delete "${packet.name}"?`)) return;

    try {
      const { error } = await supabase.from('packets').delete().eq('id', packet.id);
      if (error) throw error;
      toast({ title: 'Packet deleted successfully' });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete packet',
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setEditingPacket(null);
    setFormData({
      name: '',
      state: '',
      product_type: '',
      description: '',
      is_active: true,
      all_states: false,
      states: [],
    });
    setStateSearchQuery('');
  };

  const toggleStateSelection = (state: string) => {
    setFormData((prev) => ({
      ...prev,
      states: prev.states.includes(state)
        ? prev.states.filter((s) => s !== state)
        : [...prev.states, state],
    }));
  };

  const filteredPackets = packets.filter(
    (p) => p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredStates = US_STATES.filter((s) =>
    s.toLowerCase().includes(stateSearchQuery.toLowerCase())
  );

  const availableTemplates = templates.filter(
    (t) => !packetTemplates.some((pt) => pt.template_id === t.id)
  );

  const getStatesDisplay = (packet: Packet) => {
    if (packet.all_states) return 'All States';
    if (packet.states && packet.states.length > 0) {
      if (packet.states.length <= 3) return packet.states.join(', ');
      return `${packet.states.slice(0, 3).join(', ')} +${packet.states.length - 3}`;
    }
    return packet.state || 'TBD';
  };

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
          <h1 className="text-2xl font-bold text-foreground">Packet Management</h1>
          <p className="text-muted-foreground mt-1">Create and manage document packets</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Packet
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle>{editingPacket ? 'Edit Packet' : 'Create Packet'}</DialogTitle>
              <DialogDescription>
                {editingPacket ? 'Update packet details' : 'Add a new document packet'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4 overflow-y-auto min-h-0 flex-1 pr-1">
              <div className="space-y-2">
                <Label htmlFor="name">Packet Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., CA Conventional Package"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_active: checked }))}
                />
                <Label>Active</Label>
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : (editingPacket ? 'Update' : 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Template Assignment Dialog */}
      <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
           <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>Manage Templates - {selectedPacket?.name}</DialogTitle>
            <DialogDescription>Add and order templates in this packet</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 overflow-y-auto min-h-0 flex-1 pr-1">
            <div className="space-y-2">
              <Label>Add Template</Label>
              <Select onValueChange={handleAddTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="z-[200] bg-background border-border">
                  {availableTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.state} - {t.product_type} v{t.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Templates in Packet</Label>
              {packetTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No templates added yet</p>
              ) : (
                <div className="space-y-2">
                  {packetTemplates.map((pt, idx) => (
                    <div
                      key={pt.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                      <span className="text-sm font-medium text-muted-foreground w-6">{idx + 1}</span>
                      <FileText className="h-4 w-4 text-primary" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{pt.template?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {pt.template?.state} - {pt.template?.product_type} v{pt.template?.version}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveTemplate(pt.id)}
                        className="text-destructive hover:text-destructive shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button onClick={() => setIsTemplateDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="section-card mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search packets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {filteredPackets.length === 0 ? (
        <div className="section-card text-center py-12">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No packets found</h3>
          <p className="text-muted-foreground">Create your first packet to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPackets.map((packet) => (
            <div key={packet.id} className="section-card">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Package className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{packet.name}</h3>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleManageTemplates(packet)}>
                      <FileText className="h-4 w-4 mr-2" />
                      Manage Templates
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleEdit(packet)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDelete(packet)} className="text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {packet.description && (
                <p className="text-sm text-muted-foreground mb-3">{packet.description}</p>
              )}
              <div className="flex items-center justify-between">
                <span className={cn(
                  'inline-flex px-2.5 py-1 rounded-full text-xs font-medium',
                  packet.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                )}>
                  {packet.is_active ? 'Active' : 'Inactive'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleManageTemplates(packet)}
                >
                  Templates
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PacketManagementPage;
