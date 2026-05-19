import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Users, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
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

interface ContactsNavProps {
  isCollapsed: boolean;
  searchQuery: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const directItems = [
  { label: 'Borrower', path: '/contacts/borrowers' },
  { label: 'Lender', path: '/contacts/lenders' },
  { label: 'Broker', path: '/contacts/brokers' },
  { label: 'Additional Guarantor', path: '/contacts/additional-guarantors' },
  { label: 'Authorized Party', path: '/contacts/authorized-parties' },
];

const othersItems = [
  { label: 'Vendors', path: '/contacts/others/vendors' },
  { label: 'Tax Authority', path: '/contacts/others/tax-authority' },
  { label: 'Insurance Company', path: '/contacts/others/insurance-company' },
  { label: 'Title Company', path: '/contacts/others/title-company' },
  { label: 'Notary', path: '/contacts/others/notary' },
  { label: 'Attorney', path: '/contacts/others/attorney' },
];

export const ContactsNav: React.FC<ContactsNavProps> = ({
  isCollapsed,
  searchQuery,
  isOpen,
  onOpenChange,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [othersOpen, setOthersOpen] = useState(false);

  const matchesSearch = (text: string) =>
    !searchQuery || text.toLowerCase().includes(searchQuery.toLowerCase());

  const allPaths = [
    ...directItems.map((i) => i.path),
    ...othersItems.map((i) => i.path),
  ];
  const isAnyActive = allPaths.some((p) => location.pathname === p) || location.pathname === '/contacts';

  const filteredDirect = directItems.filter((i) => matchesSearch(i.label));
  const filteredOthers = othersItems.filter((i) => matchesSearch(i.label));
  const parentMatches = matchesSearch('Contacts');
  const othersParentMatches = matchesSearch('Others');

  if (!parentMatches && filteredDirect.length === 0 && filteredOthers.length === 0) return null;

  if (isCollapsed) {
    return (
      <>
        <div className="my-3 border-t border-sidebar-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate('/contacts')}
              className={cn(
                'sidebar-item w-full justify-center px-2',
                isAnyActive && 'sidebar-item-active'
              )}
            >
              <Users className="h-5 w-5 flex-shrink-0" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            Contacts
          </TooltipContent>
        </Tooltip>
      </>
    );
  }

  return (
    <>
      <div className="my-3 border-t border-sidebar-border" />
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              'sidebar-item w-full justify-between',
              isAnyActive && 'sidebar-item-active'
            )}
          >
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 shrink-0" />
              <span>Contacts</span>
            </div>
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-4 pt-1 space-y-0.5">
          {filteredDirect.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'sidebar-item w-full text-sm',
                location.pathname === item.path && 'sidebar-item-active'
              )}
            >
              <span>{item.label}</span>
            </button>
          ))}

          {/* Others dropdown */}
          {(othersParentMatches || filteredOthers.length > 0) && (
            <Collapsible open={othersOpen} onOpenChange={setOthersOpen}>
              <CollapsibleTrigger asChild>
                <button
                  className={cn(
                    'sidebar-item w-full justify-between text-sm',
                    othersItems.some((i) => location.pathname === i.path) && 'sidebar-item-active'
                  )}
                >
                  <span>Others</span>
                  {othersOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-4 pt-0.5 space-y-0.5">
                {filteredOthers.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={cn(
                      'sidebar-item w-full text-sm',
                      location.pathname === item.path && 'sidebar-item-active'
                    )}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
};
