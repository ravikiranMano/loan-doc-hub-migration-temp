import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  listSystemSettings,
  updateSystemSetting,
  insertSystemSetting,
  deleteSystemSetting,
} from '@/services/system/settings.service';
import { Settings, Loader2, Save, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SystemSetting {
  id: string;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  description: string | null;
  updated_at: string;
}

export const SystemSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const [newSetting, setNewSetting] = useState({
    setting_key: '',
    setting_value: '',
    setting_type: 'text',
    description: '',
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const data = await listSystemSettings();
      setSettings(data as SystemSetting[]);

      // Initialize edited values
      const values: Record<string, string> = {};
      (data || []).forEach((s) => {
        values[s.setting_key] = s.setting_value || '';
      });
      setEditedValues(values);
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (setting: SystemSetting) => {
    setSaving(true);
    try {
      await updateSystemSetting(setting.id, editedValues[setting.setting_key] || null);
      toast({ title: 'Setting saved successfully' });
      fetchSettings();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save setting',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      for (const setting of settings) {
        if (setting.setting_value !== editedValues[setting.setting_key]) {
          await updateSystemSetting(setting.id, editedValues[setting.setting_key] || null);
        }
      }
      toast({ title: 'All settings saved successfully' });
      fetchSettings();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddSetting = async () => {
    if (!newSetting.setting_key) {
      toast({
        title: 'Validation error',
        description: 'Setting key is required',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      await insertSystemSetting({
        setting_key: newSetting.setting_key,
        setting_value: newSetting.setting_value || null,
        setting_type: newSetting.setting_type,
        description: newSetting.description || null,
      });
      toast({ title: 'Setting added successfully' });
      setIsDialogOpen(false);
      setNewSetting({ setting_key: '', setting_value: '', setting_type: 'text', description: '' });
      fetchSettings();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add setting',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSetting = async (setting: SystemSetting) => {
    if (!confirm(`Are you sure you want to delete "${setting.setting_key}"?`)) return;

    try {
      await deleteSystemSetting(setting.id);
      toast({ title: 'Setting deleted successfully' });
      fetchSettings();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete setting',
        variant: 'destructive',
      });
    }
  };

  const formatKey = (key: string) => {
    return key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const hasChanges = settings.some(
    (s) => s.setting_value !== editedValues[s.setting_key]
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
          <h1 className="text-2xl font-bold text-foreground">System Settings</h1>
          <p className="text-muted-foreground mt-1">Configure application settings</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Setting
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Setting</DialogTitle>
                <DialogDescription>Create a new system configuration setting</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="settingKey">Setting Key *</Label>
                  <Input
                    id="settingKey"
                    value={newSetting.setting_key}
                    onChange={(e) => setNewSetting((prev) => ({ 
                      ...prev, 
                      setting_key: e.target.value.toLowerCase().replace(/\s+/g, '_') 
                    }))}
                    placeholder="e.g., max_upload_size"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="settingValue">Value</Label>
                  <Input
                    id="settingValue"
                    value={newSetting.setting_value}
                    onChange={(e) => setNewSetting((prev) => ({ ...prev, setting_value: e.target.value }))}
                    placeholder="Setting value"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={newSetting.setting_type}
                    onValueChange={(value) => setNewSetting((prev) => ({ ...prev, setting_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="boolean">Boolean</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="settingDescription">Description</Label>
                  <Input
                    id="settingDescription"
                    value={newSetting.description}
                    onChange={(e) => setNewSetting((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="What this setting controls"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAddSetting} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Add Setting
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {hasChanges && (
            <Button onClick={handleSaveAll} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save All Changes
            </Button>
          )}
        </div>
      </div>

      {settings.length === 0 ? (
        <div className="section-card text-center py-12">
          <Settings className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No settings configured</h3>
          <p className="text-muted-foreground">Add your first system setting</p>
        </div>
      ) : (
        <div className="space-y-4">
          {settings.map((setting) => (
            <div key={setting.id} className="section-card">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-foreground">{formatKey(setting.setting_key)}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {setting.setting_type}
                    </span>
                  </div>
                  {setting.description && (
                    <p className="text-sm text-muted-foreground mb-3">{setting.description}</p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={editedValues[setting.setting_key] || ''}
                      onChange={(e) => handleValueChange(setting.setting_key, e.target.value)}
                      type={setting.setting_type === 'number' ? 'number' : 'text'}
                      className="max-w-md"
                    />
                    {editedValues[setting.setting_key] !== setting.setting_value && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSave(setting)}
                        disabled={saving}
                      >
                        Save
                      </Button>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteSetting(setting)}
                  className="text-destructive hover:text-destructive self-start"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-card mt-8 bg-muted/50">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-1">Configuration Notes</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• <strong>Magic Link Expiry:</strong> Controls how long magic links remain valid (not yet implemented)</li>
              <li>• <strong>Default State:</strong> Pre-selected state when creating new deals</li>
              <li>• <strong>Company Name:</strong> Appears in generated documents</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemSettingsPage;
