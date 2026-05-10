import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, AppRole } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { getRoleDisplayName } from '@/lib/accessControl';
import {
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  LogOut,
  Sun,
  Moon,
  FolderOpen,
  Plus,
  Package,
  Key,
  Link,
  Sliders,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Eye,
  Menu,
  X,
  Search,
  Briefcase,
  MessageSquare,
  ListTodo,
  CheckCircle2,
  Bell,
  Landmark,
  AlertTriangle,
  Workflow,
  BookOpen,
  Scale,
  FolderLock,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import logoNew from '@/assets/Private-Lending-360-Logo.png';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { BrokerServicesNav } from '@/components/layout/BrokerServicesNav';
import { AccountingNav } from '@/components/layout/AccountingNav';
import { SystemAdminNav } from '@/components/layout/SystemAdminNav';
import { CLevelModuleNav } from '@/components/layout/CLevelModuleNav';
import { PromotedNavSection } from '@/components/layout/PromotedNavSection';
import { ContactsNav } from '@/components/layout/ContactsNav';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  roles: AppRole[];
  internalOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  roles: AppRole[];
  items: NavItem[];
}

// CSR items
const csrItems: NavItem[] = [];

// External user items - limited view
const externalItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', roles: ['borrower', 'broker', 'lender'] },
  { label: 'My Files', icon: FolderOpen, path: '/deals', roles: ['borrower', 'broker', 'lender'] },
];

// Top-level admin items
const adminItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', roles: ['admin'] },
  { label: 'User Management', icon: Users, path: '/admin/users', roles: ['admin'] },
  { label: 'Templates', icon: FileText, path: '/admin/templates', roles: ['admin'] },
  { label: 'Field Dictionary', icon: Key, path: '/admin/fields', roles: ['admin'] },
  { label: 'Field Mapping', icon: Link, path: '/admin/field-maps', roles: ['admin'] },
  { label: 'Permission Management', icon: ShieldCheck, path: '/admin/permissions', roles: ['admin'] },
];

// Simplified Configuration group - only Packets and Settings
const adminGroups: NavGroup[] = [
  {
    label: 'Configuration',
    icon: Settings,
    roles: ['admin'],
    items: [
      { label: 'Packets', icon: Package, path: '/admin/packets', roles: ['admin'] },
      { label: 'Settings', icon: Sliders, path: '/admin/settings', roles: ['admin'] },
    ],
  },
];

// My Work items
const myWorkItems: NavItem[] = [
  { label: 'Messages', icon: MessageSquare, path: '/my-work/messages', roles: ['admin', 'csr', 'borrower', 'broker', 'lender'] },
  { label: 'Queue', icon: ListTodo, path: '/my-work/queue', roles: ['admin', 'csr', 'borrower', 'broker', 'lender'] },
  { label: 'Action Items', icon: CheckCircle2, path: '/my-work/action-items', roles: ['admin', 'csr', 'borrower', 'broker', 'lender'] },
  { label: 'Alerts', icon: Bell, path: '/my-work/alerts', roles: ['admin', 'csr', 'borrower', 'broker', 'lender'] },
];

export const AppSidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, signOut, user, isExternalUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const [openGroups, setOpenGroups] = React.useState<string[]>(['Configuration', 'My Work']);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeSection, setActiveSection] = React.useState<string | null>(null);

  const handleSectionToggle = (section: string) => (open: boolean) => {
    setActiveSection(open ? section : null);
  };

  // Auto-expand Broker Services when navigating to /deals (e.g. from top nav "All Loan Documents")
  React.useEffect(() => {
    if (location.pathname === '/deals') {
      setActiveSection('broker');
    }
  }, [location.pathname]);

  // Filter items based on role
  const getFilteredItems = (): NavItem[] => {
    if (isExternalUser) {
      return externalItems.filter((item) => role && item.roles.includes(role));
    }
    return csrItems.filter((item) => role && item.roles.includes(role));
  };

  const filteredItems = getFilteredItems();
  const filteredAdminItems = adminItems.filter((item) => role && item.roles.includes(role));
  const filteredGroups = adminGroups.filter((group) => role && group.roles.includes(role));
  const filteredMyWorkItems = myWorkItems.filter((item) => role && item.roles.includes(role));

  // Apply search filter
  const searchFilter = (item: NavItem) =>
    !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase());

  const searchedItems = filteredItems.filter(searchFilter);
  const searchedAdminItems = filteredAdminItems.filter(searchFilter);
  const searchedMyWorkItems = filteredMyWorkItems.filter(searchFilter);
  const searchedGroups = filteredGroups.map((group) => ({
    ...group,
    items: group.items.filter(searchFilter),
  })).filter((group) => group.items.length > 0);

  const hasSearchResults = React.useMemo(() => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const m = (l: string) => l.toLowerCase().includes(q);
    if (searchedMyWorkItems.length > 0 || searchedItems.length > 0 || searchedAdminItems.length > 0 || searchedGroups.length > 0) return true;
    const allLabels = [
      'Broker Services','Loan Servicing','Default Services','Operations','Accounting',
      'Knowledge Center','Legal','Documents Vault','Event Journal','Contacts',
      'Statements & Reports','System Administration','C Level Module',
      'Management Dashboard','Department Alerts','Department Dashboard',
      'All Loan Files','Custom Views','Activity Journal',
      'Mod & Forbearance Wizard','Foreclosure Processing','Bankruptcy Monitoring',
      'Senior Lien Tracking','Insurance Tracking','Tax Tracking','Account Maintenance',
      'Outstanding / Missing Items','Fee Sheet','Policies & Processes','Industry News','Smart AI',
      'Accounts','Calendar','Borrowers','Brokers','Lenders',
      'User Management','Permission Management','Field Dictionary','Template Management',
      'Packet Management','System Settings','Messages','Queue','Action Items',
      'My Work','Doc Prep','Configuration',
    ];
    return allLabels.some(m);
  }, [searchQuery, searchedMyWorkItems, searchedItems, searchedAdminItems, searchedGroups]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return location.pathname === '/dashboard' || location.pathname === '/';
    }
    if (path === '/deals') {
      return location.pathname === '/deals';
    }
    return location.pathname === path;
  };

  const isGroupActive = (group: NavGroup) => {
    return group.items.some((item) => location.pathname === item.path);
  };

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    );
  };

  // Height of the fixed top portion (logo 48px + search 40px = 88px)
  const topHeight = isExternalUser ? 'h-[120px]' : 'h-[88px]';
  const topHeightPx = isExternalUser ? 120 : 88;

  return (
    <>
      {/* Fixed top bar - always w-64 */}
      <div className="fixed left-0 top-0 w-64 z-[51] bg-sidebar flex flex-col">
        {/* Logo Section with collapse arrow */}
        <div className="h-12 px-4 border-b border-sidebar-border flex items-center bg-sidebar/80">
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center justify-center flex-1">
              <img 
                src={logoNew} 
                alt="Private Lending 360"
                title="Private Lending 360"
                className="object-contain drop-shadow-sm dark:drop-shadow-[0_1px_4px_rgba(255,255,255,0.2)] dark:brightness-[1.6] dark:contrast-110 transition-transform duration-200 cursor-pointer h-11 w-auto max-w-[200px] hover:scale-[1.02]"
                style={{ imageRendering: '-webkit-optimize-contrast' }}
                onClick={() => navigate('/dashboard')}
              />
            </div>
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground transition-colors flex-shrink-0"
              aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* External User Banner */}
        {isExternalUser && (
          <div className="px-4 py-2 bg-primary/10 border-b border-sidebar-border">
            <div className="flex items-center gap-2 text-xs text-primary">
              <Eye className="h-3 w-3" />
              <span>External Access</span>
            </div>
          </div>
        )}

        {/* Search Bar - always visible */}
        <div className="h-10 px-3 border-b border-sidebar-border flex items-center">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-sidebar-foreground/50" />
            <input
              type="text"
              placeholder="Site Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Nav panel - collapses width */}
      <aside 
        className={cn(
          "fixed left-0 bg-sidebar flex flex-col z-50 transition-all duration-300",
          isCollapsed ? "w-16" : "w-64"
        )}
        style={{ top: `${topHeightPx}px`, height: `calc(100vh - ${topHeightPx}px)` }}
      >
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto sidebar-scrollbar">
          <TooltipProvider delayDuration={0}>
            {/* My Work Section */}
            {searchedMyWorkItems.length > 0 && (
              isCollapsed ? (
                <React.Fragment>
                  {searchedMyWorkItems.map((item) => (
                    <Tooltip key={item.path}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => navigate(item.path)}
                          className={cn(
                            'sidebar-item w-full justify-center px-2',
                            isActive(item.path) && 'sidebar-item-active'
                          )}
                        >
                          <item.icon className="h-5 w-5 flex-shrink-0" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="font-medium">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                  <div className="my-3 border-t border-sidebar-border" />
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <div>
                    <button
                      className={cn(
                        'sidebar-item w-full',
                        searchedMyWorkItems.some((item) => isActive(item.path)) && 'sidebar-item-active'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Briefcase className="h-5 w-5" />
                        <span>My Work</span>
                      </div>
                    </button>
                    <div className="pl-4 pt-1 space-y-1">
                      {searchedMyWorkItems.map((item) => (
                        <button
                          key={item.path}
                          onClick={() => navigate(item.path)}
                          className={cn(
                            'sidebar-item w-full text-sm',
                            isActive(item.path) && 'sidebar-item-active'
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="my-3 border-t border-sidebar-border" />
                </React.Fragment>
              )
            )}

            {/* CSR-specific sections - hidden from admin */}
            {role === 'csr' && (
              <BrokerServicesNav isCollapsed={isCollapsed} searchQuery={searchQuery} isOpen={activeSection === 'broker'} onOpenChange={handleSectionToggle('broker')} />
            )}

            {/* Loan Servicing (promoted from Broker Services) - CSR only */}
            {role === 'csr' && (
              <PromotedNavSection
                label="Loan Servicing"
                icon={Landmark}
                items={[
                  { label: 'Management Dashboard', path: '/broker-services/servicing/management' },
                  { label: 'Department Alerts', path: '/broker-services/servicing/alerts' },
                  { label: 'Department Dashboard', path: '/broker-services/servicing/dashboard' },
                  { label: 'All Loan Servicing Files', path: '/deals' },
                  { label: 'Custom Views', path: '/broker-services/servicing/custom-views' },
                  { label: 'Activity Journal', path: '/broker-services/servicing/activity' },
                ]}
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
                isOpen={activeSection === 'loan-servicing'}
                onOpenChange={handleSectionToggle('loan-servicing')}
              />
            )}

            {/* Operations (promoted from Broker Services) - CSR only */}
            {role === 'csr' && (
              <PromotedNavSection
                label="Operations"
                icon={Workflow}
                items={[
                  { label: 'Management Dashboard', path: '/broker-services/operations/management' },
                  { label: 'Department Alerts', path: '/broker-services/operations/alerts' },
                  { label: 'Department Dashboard', path: '/broker-services/operations/dashboard' },
                  { label: 'Senior Lien Tracking', path: '/broker-services/operations/senior-lien' },
                  { label: 'Insurance Tracking', path: '/broker-services/operations/insurance' },
                  { label: 'Tax Tracking', path: '/broker-services/operations/tax' },
                  { label: 'Account Maintenance', path: '/broker-services/operations/maintenance' },
                  { label: 'Outstanding / Missing Items', path: '/broker-services/operations/outstanding' },
                  { label: 'Activity Journal', path: '/broker-services/operations/activity' },
                ]}
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
                isOpen={activeSection === 'operations'}
                onOpenChange={handleSectionToggle('operations')}
              />
            )}

            {/* Default Services (promoted from Broker Services) - CSR only */}
            {role === 'csr' && (
              <PromotedNavSection
                label="Default Services"
                icon={AlertTriangle}
                items={[
                  { label: 'Management Dashboard', path: '/broker-services/default/management' },
                  { label: 'Department Alerts', path: '/broker-services/default/alerts' },
                  { label: 'Department Dashboard', path: '/broker-services/default/dashboard' },
                  { label: 'Mod & Forbearance Wizard', path: '/broker-services/default/mod-forbearance' },
                  { label: 'Foreclosure Processing', path: '/broker-services/default/foreclosure' },
                  { label: 'Bankruptcy Monitoring', path: '/broker-services/default/bankruptcy' },
                  { label: 'Activity Journal', path: '/broker-services/default/activity' },
                ]}
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
                isOpen={activeSection === 'default-services'}
                onOpenChange={handleSectionToggle('default-services')}
              />
            )}

            {/* Accounting Section - CSR only */}
            {role === 'csr' && (
              <AccountingNav isCollapsed={isCollapsed} searchQuery={searchQuery} isOpen={activeSection === 'accounting'} onOpenChange={handleSectionToggle('accounting')} />
            )}

            {/* Knowledge Center (promoted from Accounting) - CSR only */}
            {role === 'csr' && (
              <PromotedNavSection
                label="Knowledge Center"
                icon={BookOpen}
                items={[
                  { label: 'Fee Sheet', path: '/accounting/knowledge/fee-sheet' },
                  { label: 'Policies & Processes', path: '/accounting/knowledge/policies' },
                  { label: 'Industry News', path: '/accounting/knowledge/news' },
                  { label: 'Smart AI', path: '/accounting/knowledge/smart-ai' },
                ]}
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
                isOpen={activeSection === 'knowledge-center'}
                onOpenChange={handleSectionToggle('knowledge-center')}
              />
            )}

            {/* Legal (promoted from Accounting) - CSR only */}
            {role === 'csr' && (
              <PromotedNavSection
                label="Legal"
                icon={Scale}
                items={[
                  { label: 'Management Dashboard', path: '/accounting/legal/management' },
                  { label: 'Department Alerts', path: '/accounting/legal/alerts' },
                  { label: 'Department Dashboard', path: '/accounting/legal/dashboard' },
                  { label: 'Accounts', path: '/accounting/legal/accounts' },
                  { label: 'Calendar', path: '/accounting/legal/calendar' },
                  { label: 'Activity Journal', path: '/accounting/legal/activity' },
                ]}
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
                isOpen={activeSection === 'legal'}
                onOpenChange={handleSectionToggle('legal')}
              />
            )}

            {/* Documents Vault moved below Statements & Reports */}

            {/* Event Journal - CSR and Admin */}
            {(role === 'csr' || role === 'admin') && (
              <PromotedNavSection
                label="Event Journal"
                icon={BookOpen}
                items={[]}
                directPath="/event-journal"
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
              />
            )}

            {/* Contacts - CSR only */}
            {role === 'csr' && (
              <ContactsNav
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
                isOpen={activeSection === 'contacts'}
                onOpenChange={handleSectionToggle('contacts')}
              />
            )}

            {/* Statements & Reports - CSR only */}
            {role === 'csr' && (
              <PromotedNavSection
                label="Statements & Reports"
                icon={BarChart3}
                items={[]}
                isCollapsed={isCollapsed}
                searchQuery={searchQuery}
              />
            )}

            {/* System Administration Section - CSR only */}
            {role === 'csr' && (
              <SystemAdminNav isCollapsed={isCollapsed} searchQuery={searchQuery} isOpen={activeSection === 'sysadmin'} onOpenChange={handleSectionToggle('sysadmin')} />
            )}

            {/* C Level Module Section - CSR only */}
            {role === 'csr' && (
              <CLevelModuleNav isCollapsed={isCollapsed} searchQuery={searchQuery} isOpen={activeSection === 'clevel'} onOpenChange={handleSectionToggle('clevel')} />
            )}

            {/* Regular Nav Items */}
            {searchedItems.map((item) => (
              isCollapsed ? (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(item.path)}
                      className={cn(
                        'sidebar-item w-full justify-center px-2',
                        isActive(item.path) && 'sidebar-item-active'
                      )}
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    'sidebar-item w-full',
                    isActive(item.path) && 'sidebar-item-active'
                  )}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              )
            ))}

            {/* Separator before admin items */}
            {searchedAdminItems.length > 0 && (
              <div className="my-3 border-t border-sidebar-border" />
            )}

            {/* Top-level Admin Items */}
            {searchedAdminItems.map((item) => (
              isCollapsed ? (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(item.path)}
                      className={cn(
                        'sidebar-item w-full justify-center px-2',
                        isActive(item.path) && 'sidebar-item-active'
                      )}
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    'sidebar-item w-full',
                    isActive(item.path) && 'sidebar-item-active'
                  )}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              )
            ))}

            {/* Separator before Configuration group */}
            {searchedGroups.length > 0 && !isCollapsed && (
              <div className="my-3 border-t border-sidebar-border" />
            )}

            {/* Configuration items shown as tooltips when collapsed */}
            {isCollapsed && searchedGroups.map((group) => (
              <React.Fragment key={group.label}>
                <div className="my-3 border-t border-sidebar-border" />
                {group.items.map((item) => (
                  <Tooltip key={item.path}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => navigate(item.path)}
                        className={cn(
                          'sidebar-item w-full justify-center px-2',
                          location.pathname === item.path && 'sidebar-item-active'
                        )}
                      >
                        <item.icon className="h-5 w-5 flex-shrink-0" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="font-medium">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </React.Fragment>
            ))}

            {/* Grouped Nav Items (Configuration) - only show when not collapsed */}
            {!isCollapsed && searchedGroups.map((group) => (
              <Collapsible
                key={group.label}
                open={openGroups.includes(group.label)}
                onOpenChange={() => toggleGroup(group.label)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    className={cn(
                      'sidebar-item w-full justify-between',
                      isGroupActive(group) && 'sidebar-item-active'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <group.icon className="h-5 w-5" />
                      <span>{group.label}</span>
                    </div>
                    {openGroups.includes(group.label) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 pt-1 space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className={cn(
                        'sidebar-item w-full text-sm',
                        location.pathname === item.path && 'sidebar-item-active'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}

            {/* No results message */}
            {searchQuery && !hasSearchResults && !isCollapsed && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No results found
              </div>
            )}
          </TooltipProvider>
        </nav>
      </aside>
    </>
  );
};
