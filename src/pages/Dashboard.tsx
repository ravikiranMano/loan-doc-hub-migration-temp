import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { countProfiles } from '@/services/admin/profiles.service';
import { listDealsForDashboard } from '@/services/deals/deals.service';
import { countActiveTemplates } from '@/services/documents/templates.service';
import { countFieldDictionary } from '@/services/admin/field-dictionary.service';
import { 
  FolderOpen, 
  FileText, 
  Users, 
  Clock,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Key,
  Link,
  Package,
  Sliders,
  Tags
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
  className?: string;
  loading?: boolean;
}

interface DealSummary {
  id: string;
  deal_number: string;
  borrower_name: string | null;
  status: 'draft' | 'ready' | 'generated';
  updated_at: string;
}

interface DashboardStats {
  totalDeals: number;
  draftDeals: number;
  readyDeals: number;
  generatedDeals: number;
}

interface AdminQuickLink {
  title: string;
  description: string;
  icon: React.ElementType;
  path: string;
  color: string;
}

const adminQuickLinks: AdminQuickLink[] = [
  {
    title: 'User Management',
    description: 'Create and manage Admin and CSR users',
    icon: Users,
    path: '/admin/users',
    color: 'bg-blue-500/10 text-blue-500',
  },
  {
    title: 'Template Management',
    description: 'Create and version document templates',
    icon: FileText,
    path: '/admin/templates',
    color: 'bg-green-500/10 text-green-500',
  },
  {
    title: 'Field Dictionary',
    description: 'Define data fields and their properties',
    icon: Key,
    path: '/admin/fields',
    color: 'bg-orange-500/10 text-orange-500',
  },
  {
    title: 'Field Mapping',
    description: 'Map fields to templates with transform rules',
    icon: Link,
    path: '/admin/field-maps',
    color: 'bg-cyan-500/10 text-cyan-500',
  },
  {
    title: 'Packet Management',
    description: 'Create packets and assign templates',
    icon: Package,
    path: '/admin/packets',
    color: 'bg-indigo-500/10 text-indigo-500',
  },
];

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, trend, className, loading }) => (
  <div className={cn('stats-card', className)}>
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </div>
    <div className="flex items-end gap-2">
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <span className="text-3xl font-bold text-foreground">{value}</span>
      )}
      {trend && !loading && (
        <span className="text-sm text-success flex items-center gap-1 mb-1">
          <TrendingUp className="h-3 w-3" />
          {trend}
        </span>
      )}
    </div>
  </div>
);

const CSRDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({ totalDeals: 0, draftDeals: 0, readyDeals: 0, generatedDeals: 0 });
  const [recentDeals, setRecentDeals] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch all deals for stats
      const allDeals = await listDealsForDashboard();
      
      setStats({
        totalDeals: allDeals.length,
        draftDeals: allDeals.filter(d => d.status === 'draft').length,
        readyDeals: allDeals.filter(d => d.status === 'ready').length,
        generatedDeals: allDeals.filter(d => d.status === 'generated').length,
      });

      // Get recent 5 deals
      setRecentDeals(allDeals.slice(0, 5) as DealSummary[]);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'draft': return { label: 'Draft', color: 'text-muted-foreground' };
      case 'ready': return { label: 'Ready', color: 'text-primary' };
      case 'generated': return { label: 'Generated', color: 'text-success' };
      default: return { label: status, color: 'text-muted-foreground' };
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Files" value={stats.totalDeals} icon={FolderOpen} loading={loading} />
        <StatCard label="Draft" value={stats.draftDeals} icon={Clock} loading={loading} />
        <StatCard label="Ready" value={stats.readyDeals} icon={CheckCircle2} loading={loading} />
        <StatCard label="Generated" value={stats.generatedDeals} icon={FileText} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="section-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Recent Files</h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : recentDeals.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No files yet</p>
          ) : (
            <div className="space-y-3">
              {recentDeals.map((deal) => {
                const statusDisplay = getStatusDisplay(deal.status);
                return (
                  <div 
                    key={deal.id} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                    onClick={() => navigate(`/deals/${deal.id}`)}
                  >
                    <div>
                      <p className="font-medium text-foreground">{deal.deal_number}</p>
                      {deal.borrower_name && <p className="text-sm text-muted-foreground">{deal.borrower_name}</p>}
                    </div>
                    <div className="text-right">
                      <p className={cn('text-sm font-medium', statusDisplay.color)}>
                        {statusDisplay.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(deal.updated_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="section-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => navigate('/deals/new')}
              className="p-4 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors text-left group"
            >
              <FolderOpen className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <p className="font-medium text-foreground">New File</p>
              <p className="text-sm text-muted-foreground">Start a new loan application</p>
            </button>
            <button 
              onClick={() => navigate('/users')}
              className="p-4 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors text-left group"
            >
              <Users className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <p className="font-medium text-foreground">View Users</p>
              <p className="text-sm text-muted-foreground">Manage user directory</p>
            </button>
            <button 
              onClick={() => navigate('/documents')}
              className="p-4 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors text-left group"
            >
              <FileText className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <p className="font-medium text-foreground">Documents</p>
              <p className="text-sm text-muted-foreground">Download generated docs</p>
            </button>
            <button 
              onClick={() => navigate('/deals')}
              className="p-4 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors text-left group"
            >
              <Clock className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <p className="font-medium text-foreground">All Files</p>
              <p className="text-sm text-muted-foreground">View all files</p>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [userCount, setUserCount] = useState(0);
  const [templateCount, setTemplateCount] = useState(0);
  const [fieldCount, setFieldCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [usersCount, templatesCount, fieldsCount] = await Promise.all([
          countProfiles(),
          countActiveTemplates(),
          countFieldDictionary(),
        ]);
        
        setUserCount(usersCount);
        setTemplateCount(templatesCount);
        setFieldCount(fieldsCount);
      } catch (error) {
        console.error('Error fetching counts:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchCounts();
  }, []);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Users" value={userCount} icon={Users} loading={loading} />
        <StatCard label="Active Templates" value={templateCount} icon={FileText} loading={loading} />
        <StatCard label="Field Dictionary" value={fieldCount} icon={Key} loading={loading} />
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Quick Access</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {adminQuickLinks.map((link) => (
            <button
              key={link.path}
              onClick={() => navigate(link.path)}
              className="section-card text-left hover:shadow-lg transition-all duration-200 hover:-translate-y-1 group"
            >
              <div className="flex items-start gap-4">
                <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform', link.color)}>
                  <link.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-foreground mb-1">{link.title}</h4>
                  <p className="text-sm text-muted-foreground">{link.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

export const Dashboard: React.FC = () => {
  const { role, user } = useAuth();

  return (
    <div className="page-container">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          Welcome back{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name}` : ''}
        </h1>
        <p className="text-muted-foreground mt-1">
          {role === 'admin' 
            ? 'Manage system configuration and users'
            : 'Here\'s what\'s happening with your files today'
          }
        </p>
      </div>

      {role === 'admin' ? <AdminDashboard /> : <CSRDashboard />}
    </div>
  );
};

export default Dashboard;
