import React, { useState, useEffect } from 'react';
import { searchDealsBrief } from '@/services/deals/deals.service';
import { EventJournalViewer } from '@/components/deal/EventJournalViewer';
import { Input } from '@/components/ui/input';
import { BookOpen, Search } from 'lucide-react';

interface DealOption {
  id: string;
  deal_number: string;
  borrower_name: string | null;
}

const GlobalEventJournalPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchDeals = async () => {
      setLoading(true);
      const data = await searchDealsBrief(search, 50);
      setDeals(data || []);
      setLoading(false);
    };

    const debounce = setTimeout(fetchDeals, 300);
    return () => clearTimeout(debounce);
  }, [search]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Global Event Journal</h1>
      </div>

      <div className="flex items-center gap-4 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by deal number or borrower…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {!selectedDealId && (
        <div className="border rounded-lg divide-y max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="p-4 text-muted-foreground text-sm">Loading deals…</div>
          ) : deals.length === 0 ? (
            <div className="p-4 text-muted-foreground text-sm">No deals found.</div>
          ) : (
            deals.map((deal) => (
              <button
                key={deal.id}
                className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between"
                onClick={() => setSelectedDealId(deal.id)}
              >
                <span className="font-medium text-foreground">{deal.deal_number}</span>
                <span className="text-sm text-muted-foreground">{deal.borrower_name || '—'}</span>
              </button>
            ))
          )}
        </div>
      )}

      {selectedDealId && (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedDealId(null)}
            className="text-sm text-primary hover:underline"
          >
            ← Back to deal list
          </button>
          <EventJournalViewer dealId={selectedDealId} />
        </div>
      )}
    </div>
  );
};

export default GlobalEventJournalPage;
