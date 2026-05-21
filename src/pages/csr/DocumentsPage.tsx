import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDealsByStatuses } from '@/services/deals/deals.service';
import {
  listGeneratedDocumentsByDealIds,
  downloadGeneratedDoc,
} from '@/services/documents/generation.service';
import { fetchTemplatesByIds } from '@/services/documents/templates.service';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  FileText, 
  Download, 
  Search, 
  FolderOpen, 
  ChevronDown,
  Eye,
  Loader2,
  FileType,
  File
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface GeneratedDocument {
  id: string;
  deal_id: string;
  template_id: string;
  template_name: string | null;
  packet_id: string | null;
  packet_name: string | null;
  generation_batch_id: string | null;
  output_docx_path: string;
  output_pdf_path: string | null;
  version_number: number;
  created_at: string;
  generation_status: string;
}

interface Deal {
  id: string;
  deal_number: string;
  borrower_name: string | null;
  status: string;
  created_at: string;
}

interface DealWithDocuments extends Deal {
  documents: GeneratedDocument[];
  lastGeneratedAt: string | null;
}

export const DocumentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [deals, setDeals] = useState<DealWithDocuments[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [templateLookup, setTemplateLookup] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    fetchDealsWithDocuments();
  }, []);

  const fetchDealsWithDocuments = async () => {
    try {
      setLoading(true);

      // Fetch deals with ready or generated status
      const dealsData = await listDealsByStatuses(
        ['ready', 'generated'],
        'id, deal_number, borrower_name, status, created_at'
      );

      if (!dealsData || dealsData.length === 0) {
        setDeals([]);
        return;
      }

      // Fetch documents for these deals
      const dealIds = dealsData.map(d => d.id);
      const docsData = await listGeneratedDocumentsByDealIds(dealIds);

      // Build template lookup for docs without denormalized names
      const templateIds = [...new Set((docsData || []).filter(d => !d.template_name).map(d => d.template_id))];
      if (templateIds.length > 0) {
        const templatesData = await fetchTemplatesByIds(templateIds, 'id, name');
        if (templatesData.length) {
          const lookup = new Map(templatesData.map((t) => [t.id, t.name]));
          setTemplateLookup(lookup);
        }
      }

      // Map documents to deals
      const dealsWithDocs: DealWithDocuments[] = dealsData.map(deal => {
        const dealDocs = (docsData || []).filter(doc => doc.deal_id === deal.id);
        const lastDoc = dealDocs.length > 0 ? dealDocs[0] : null;
        
        return {
          ...deal,
          documents: dealDocs,
          lastGeneratedAt: lastDoc?.created_at || null,
        };
      });

      setDeals(dealsWithDocs);
    } catch (error: any) {
      console.error('Error fetching deals with documents:', error);
      toast({
        title: 'Error',
        description: 'Failed to load documents',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (document: GeneratedDocument, type: 'docx' | 'pdf') => {
    const path = type === 'docx' ? document.output_docx_path : document.output_pdf_path;
    if (!path) {
      toast({
        title: 'Not Available',
        description: `${type.toUpperCase()} file is not available for this document`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setDownloadingId(document.id);
      
      const data = await downloadGeneratedDoc(path);

      // Create download link
      const url = URL.createObjectURL(data);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = path.split('/').pop() || `document.${type}`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Downloaded',
        description: `${type.toUpperCase()} file downloaded successfully`,
      });
    } catch (error: any) {
      console.error('Download error:', error);
      toast({
        title: 'Download Failed',
        description: error.message || 'Failed to download file',
        variant: 'destructive',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const filteredDeals = deals.filter(deal => 
    deal.deal_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (deal.borrower_name?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const getDocName = (doc: GeneratedDocument): string => {
    if (doc.template_name) return doc.template_name;
    return templateLookup.get(doc.template_id) || 'Unknown Template';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'generated':
        return <Badge className="bg-success/10 text-success hover:bg-success/10">Generated</Badge>;
      case 'ready':
        return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Ready</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Documents</h1>
          <p className="text-muted-foreground mt-1">Download generated documents for completed files</p>
        </div>
      </div>

      <div className="section-card mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by file number or borrower..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="section-card text-center py-12">
          <Loader2 className="h-8 w-8 mx-auto text-muted-foreground animate-spin mb-4" />
          <p className="text-muted-foreground">Loading documents...</p>
        </div>
      ) : filteredDeals.length === 0 ? (
        <div className="section-card text-center py-16">
          <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">No Documents Available</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            {searchQuery 
              ? 'No files match your search criteria.' 
              : 'Complete a file and generate documents to see them here.'}
          </p>
          <Button onClick={() => navigate('/deals')} variant="outline" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            View Files
          </Button>
        </div>
      ) : (
        <div className="section-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Number</TableHead>
                <TableHead>Borrower</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead>Last Generated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeals.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell className="font-medium">{deal.deal_number}</TableCell>
                  <TableCell>{deal.borrower_name || '—'}</TableCell>
                  <TableCell>{getStatusBadge(deal.status)}</TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      {deal.documents.length} document{deal.documents.length !== 1 ? 's' : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    {deal.lastGeneratedAt 
                      ? format(new Date(deal.lastGeneratedAt), 'MMM d, yyyy h:mm a')
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/deals/${deal.id}`)}
                        className="gap-1"
                      >
                        <Eye className="h-4 w-4" />
                        View
                      </Button>
                      
                      {deal.documents.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1">
                              <Download className="h-4 w-4" />
                              Download
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-72">
                            {deal.documents.map((doc) => (
                              <React.Fragment key={doc.id}>
                                <DropdownMenuItem
                                  onClick={() => handleDownload(doc, 'docx')}
                                  disabled={downloadingId === doc.id}
                                  className="gap-2"
                                >
                                  <FileType className="h-4 w-4 text-primary" />
                                  <div className="flex-1 min-w-0">
                                    <span className="block truncate text-sm font-medium">
                                      {getDocName(doc)} v{doc.version_number} (DOCX)
                                    </span>
                                    {doc.packet_name && (
                                      <span className="block text-xs text-muted-foreground truncate">
                                        via Packet: {doc.packet_name}
                                      </span>
                                    )}
                                  </div>
                                </DropdownMenuItem>
                                {doc.output_pdf_path && (
                                  <DropdownMenuItem
                                    onClick={() => handleDownload(doc, 'pdf')}
                                    disabled={downloadingId === doc.id}
                                    className="gap-2"
                                  >
                                    <File className="h-4 w-4 text-destructive" />
                                    <div className="flex-1 min-w-0">
                                      <span className="block truncate text-sm font-medium">
                                        {getDocName(doc)} v{doc.version_number} (PDF)
                                      </span>
                                    </div>
                                  </DropdownMenuItem>
                                )}
                              </React.Fragment>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;
