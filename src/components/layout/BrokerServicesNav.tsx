import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  FolderOpen,
  Activity,
  FileText,
  Package,
  MessageSquare,
  Bell,
  Eye,
  Search,
  Wrench,
  Shield,
  ClipboardList,
  AlertTriangle,
  Landmark,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface SubItem {
  label: string;
  path: string;
}

interface ChildSection {
  label: string;
  items: SubItem[];
}

const brokerServicesTopItems = [
  { label: 'Management Dashboard', path: '/dashboard' },
  { label: 'Department Alerts', path: '/broker-services/department-alerts' },
];

const brokerServicesData: ChildSection[] = [
  {
    label: 'Loan Origination Services',
    items: [
      { label: 'Department Dashboard', path: '/broker-services/origination/dashboard' },
      { label: 'All Origination Files', path: '/broker-services/origination/files' },
      { label: 'Activity Journal', path: '/broker-services/origination/activity' },
    ],
  },
  {
    label: 'Loan Documents Processing',
    items: [
      { label: 'Department Dashboard', path: '/broker-services/documents/dashboard' },
      { label: 'All Loan Document Files', path: '/deals' },
      { label: 'Loan Documents', path: '/broker-services/documents/loan-documents' },
      { label: 'Document Packets', path: '/broker-services/documents/packets' },
      { label: 'Activity Journal', path: '/broker-services/documents/activity' },
    ],
  },
  {
    label: 'New Account Intake',
    items: [
      { label: 'Department Dashboard', path: '/broker-services/intake/dashboard' },
      { label: 'All Loan Servicing Files', path: '/deals' },
      { label: 'Messages', path: '/broker-services/intake/messages' },
      { label: 'Activity Journal', path: '/broker-services/intake/activity' },
    ],
  },
];

interface BrokerServicesNavProps {
  isCollapsed: boolean;
  searchQuery: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const BrokerServicesNav: React.FC<BrokerServicesNavProps> = ({ isCollapsed, searchQuery, isOpen, onOpenChange }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const openParent = isOpen !== undefined ? isOpen : internalOpen;
  const handleOpenChange = onOpenChange || setInternalOpen;
  const [openChildren, setOpenChildren] = React.useState<string[]>(() => {
    if (location.pathname === '/deals') return ['Loan Documents Processing'];
    return [];
  });
  // Track which section the user last navigated from (for shared paths like /deals)
  // Default to 'Loan Documents Processing' for /deals so only that section highlights
  const [activeSection, setActiveSection] = React.useState<string | null>(() => {
    if (location.pathname === '/deals' || location.pathname.startsWith('/deals/')) {
      return 'Loan Documents Processing';
    }
    return null;
  });

  // Auto-expand when navigating to /deals (e.g. from top nav "All Loan Documents")
  React.useEffect(() => {
    if (location.pathname === '/deals') {
      setActiveSection('Loan Documents Processing');
      setOpenChildren(prev => prev.includes('Loan Documents Processing') ? prev : [...prev, 'Loan Documents Processing']);
      // Also ensure parent is open
      if (!openParent) handleOpenChange(true);
    }
  }, [location.pathname]);

  const collapseAll = () => {
    setOpenChildren([]);
  };

  const toggleChild = (label: string) => {
    setOpenChildren((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  // Filter sections based on search
  const filteredSections = brokerServicesData
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter(
      (section) =>
        section.items.length > 0 ||
        (!searchQuery || section.label.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const parentMatchesSearch =
    !searchQuery || 'broker services'.includes(searchQuery.toLowerCase());

  if (!parentMatchesSearch && filteredSections.length === 0) {
    return null;
  }

  const isAnyActive = brokerServicesData.some((s) =>
    s.items.some((i) => location.pathname === i.path)
  );

  if (isCollapsed) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(
                'sidebar-item w-full justify-center px-2',
                isAnyActive && 'sidebar-item-active'
              )}
            >
              <Building2 className="h-5 w-5 flex-shrink-0" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            Broker Services
          </TooltipContent>
        </Tooltip>
      </>
    );
  }

  return (
    <>
      <Collapsible open={openParent} onOpenChange={handleOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              'sidebar-item w-full justify-between',
              isAnyActive && 'sidebar-item-active'
            )}
          >
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5" />
              <span>Broker Services</span>
            </div>
            {openParent ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-3 pt-1 space-y-0.5">
          {brokerServicesTopItems
            .filter((item) => !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((item) => (
              <button
                key={item.path + item.label}
                onClick={() => { collapseAll(); navigate(item.path); }}
                className={cn(
                  'sidebar-item w-full text-sm',
                  location.pathname === item.path && 'sidebar-item-active'
                )}
              >
                <span>{item.label}</span>
              </button>
            ))}
          {filteredSections.map((section) => (
            <Collapsible
              key={section.label}
              open={openChildren.includes(section.label)}
              onOpenChange={() => toggleChild(section.label)}
            >
              <CollapsibleTrigger asChild>
                <button
                  className={cn(
                    'sidebar-item w-full justify-between text-sm text-left',
                    section.items.some((i) => {
                      if (location.pathname !== i.path) return false;
                      const isSharedPath = brokerServicesData.some(s => s.label !== section.label && s.items.some(si => si.path === i.path));
                      return !isSharedPath || activeSection === section.label;
                    }) && 'sidebar-item-active'
                  )}
                >
                  <span className="text-left">{section.label}</span>
                  {openChildren.includes(section.label) ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-4 pt-0.5 space-y-0.5">
                {section.items.map((item) => {
                  // For shared paths, only highlight if this is the active section
                  const isSharedPath = brokerServicesData.filter(s => s.label !== section.label).some(s => s.items.some(si => si.path === item.path));
                  const isItemActive = location.pathname === item.path && (!isSharedPath || activeSection === section.label);
                  return (
                    <button
                      key={item.path + '-' + section.label}
                      onClick={() => { setOpenChildren([section.label]); setActiveSection(section.label); navigate(item.path); }}
                      className={cn(
                        'sidebar-item w-full text-sm',
                        isItemActive && 'sidebar-item-active'
                      )}
                    >
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
};
