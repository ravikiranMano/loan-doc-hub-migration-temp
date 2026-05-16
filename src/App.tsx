import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SidebarProvider } from "@/contexts/SidebarContext";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { AuthPage } from "./components/auth/AuthPage";
import { AppLayout } from "./components/layout/AppLayout";
import { RoleGuard } from "./components/layout/RoleGuard";
import Dashboard from "./pages/Dashboard";
import DealsPage from "./pages/csr/DealsPage";
import CreateDealPage from "./pages/csr/CreateDealPage";
import DealOverviewPage from "./pages/csr/DealOverviewPage";
import DealDataEntryPage from "./pages/csr/DealDataEntryPage";
import DealDocumentsPage from "./pages/csr/DealDocumentsPage";
import UsersPage from "./pages/csr/UsersPage";
import DocumentsPage from "./pages/csr/DocumentsPage";
import ConfigurationPage from "./pages/admin/ConfigurationPage";
import UserManagementPage from "./pages/admin/UserManagementPage";
import TemplateManagementPage from "./pages/admin/TemplateManagementPage";
import PacketManagementPage from "./pages/admin/PacketManagementPage";
import FieldDictionaryPage from "./pages/admin/FieldDictionaryPage";
import FieldMapEditorPage from "./pages/admin/FieldMapEditorPage";
import SystemSettingsPage from "./pages/admin/SystemSettingsPage";
import PermissionManagementPage from "./pages/admin/PermissionManagementPage";
import MagicLinkAccessPage from "./pages/MagicLinkAccessPage";
import ComingSoonPage from "./pages/ComingSoonPage";
import GlobalEventJournalPage from "./pages/csr/GlobalEventJournalPage";
import ContactLendersPage from "./pages/contacts/ContactLendersPage";
import ContactBorrowersPage from "./pages/contacts/ContactBorrowersPage";
import ContactBrokersPage from "./pages/contacts/ContactBrokersPage";
import ContactCoBorrowersPage from "./pages/contacts/ContactCoBorrowersPage";
import ContactAuthorizedPartiesPage from "./pages/contacts/ContactAuthorizedPartiesPage";
import ContactAdditionalGuarantorsPage from "./pages/contacts/ContactAdditionalGuarantorsPage";
import ScrollToTop from "./components/ScrollToTop";


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <SidebarProvider>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<AuthPage />} />
                
                {/* Magic link access - no auth required */}
                <Route path="/access/:token" element={<MagicLinkAccessPage />} />
                
                {/* Single AppLayout instance for all protected routes */}
                <Route element={<AppLayout />}>
                  {/* Open to all authenticated users */}
                  <Route path="/dashboard" element={<Dashboard />} />

                  {/* My Work */}
                  <Route path="/my-work/messages" element={<ComingSoonPage />} />
                  <Route path="/my-work/queue" element={<ComingSoonPage />} />
                  <Route path="/my-work/action-items" element={<ComingSoonPage />} />
                  <Route path="/my-work/alerts" element={<ComingSoonPage />} />

                  {/* Contacts */}
                  <Route path="/contacts" element={<ComingSoonPage />} />
                  <Route path="/contacts/lenders" element={<ContactLendersPage />} />
                  <Route path="/contacts/lenders/:contactId" element={<ContactLendersPage />} />
                  <Route path="/contacts/borrowers" element={<ContactBorrowersPage />} />
                  <Route path="/contacts/borrowers/:contactId" element={<ContactBorrowersPage />} />
                  <Route path="/contacts/brokers" element={<ContactBrokersPage />} />
                  <Route path="/contacts/brokers/:contactId" element={<ContactBrokersPage />} />
                  <Route path="/contacts/others/vendors" element={<ComingSoonPage />} />
                  <Route path="/contacts/others/tax-authority" element={<ComingSoonPage />} />
                  <Route path="/contacts/others/insurance-company" element={<ComingSoonPage />} />
                  <Route path="/contacts/others/title-company" element={<ComingSoonPage />} />
                  <Route path="/contacts/others/notary" element={<ComingSoonPage />} />
                  <Route path="/contacts/co-borrowers" element={<ContactCoBorrowersPage />} />
                  <Route path="/contacts/co-borrowers/:contactId" element={<ContactCoBorrowersPage />} />
                  <Route path="/contacts/additional-guarantors" element={<ContactAdditionalGuarantorsPage />} />
                  <Route path="/contacts/additional-guarantors/:contactId" element={<ContactAdditionalGuarantorsPage />} />
                  <Route path="/contacts/authorized-parties" element={<ContactAuthorizedPartiesPage />} />
                  <Route path="/contacts/authorized-parties/:contactId" element={<ContactAuthorizedPartiesPage />} />
                  <Route path="/contacts/others/additional-guarantor" element={<ComingSoonPage />} />
                  <Route path="/contacts/others/authorized-party" element={<ComingSoonPage />} />
                  <Route path="/contacts/others/attorney" element={<ComingSoonPage />} />

                  {/* Broker Services */}
                  <Route path="/broker-services/department-alerts" element={<ComingSoonPage />} />
                  <Route path="/broker-services/origination/dashboard" element={<ComingSoonPage />} />
                  <Route path="/broker-services/origination/activity" element={<ComingSoonPage />} />
                  <Route path="/broker-services/documents/dashboard" element={<ComingSoonPage />} />
                  <Route path="/broker-services/documents/activity" element={<ComingSoonPage />} />
                  <Route path="/broker-services/documents/packets" element={<ComingSoonPage />} />
                  <Route path="/broker-services/documents/loan-documents" element={<ComingSoonPage />} />
                  <Route path="/broker-services/intake/dashboard" element={<ComingSoonPage />} />
                  <Route path="/broker-services/intake/activity" element={<ComingSoonPage />} />
                  <Route path="/broker-services/intake/messages" element={<ComingSoonPage />} />
                  <Route path="/broker-services/servicing/management" element={<ComingSoonPage />} />
                  <Route path="/broker-services/servicing/alerts" element={<ComingSoonPage />} />
                  <Route path="/broker-services/servicing/dashboard" element={<ComingSoonPage />} />
                  <Route path="/broker-services/servicing/activity" element={<ComingSoonPage />} />
                  <Route path="/broker-services/servicing/custom-views" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/management" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/alerts" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/dashboard" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/activity" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/senior-lien" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/insurance" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/tax" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/maintenance" element={<ComingSoonPage />} />
                  <Route path="/broker-services/operations/outstanding" element={<ComingSoonPage />} />
                  <Route path="/broker-services/default/management" element={<ComingSoonPage />} />
                  <Route path="/broker-services/default/alerts" element={<ComingSoonPage />} />
                  <Route path="/broker-services/default/dashboard" element={<ComingSoonPage />} />
                  <Route path="/broker-services/default/activity" element={<ComingSoonPage />} />
                  <Route path="/broker-services/default/mod-forbearance" element={<ComingSoonPage />} />
                  <Route path="/broker-services/default/foreclosure" element={<ComingSoonPage />} />
                  <Route path="/broker-services/default/bankruptcy" element={<ComingSoonPage />} />
                  <Route path="/broker-services/*" element={<ComingSoonPage />} />

                  <Route path="/accounting/legal/management" element={<Dashboard />} />
                  <Route path="/accounting/*" element={<ComingSoonPage />} />
                  <Route path="/system-admin/*" element={<ComingSoonPage />} />
                  <Route path="/c-level/*" element={<ComingSoonPage />} />

                  {/* Deal viewing - accessible by CSR, Admin, and external users */}
                  <Route element={<RoleGuard requiredRoles={['csr', 'admin', 'borrower', 'broker', 'lender']} />}>
                    <Route path="/deals" element={<DealsPage />} />
                    <Route path="/deals/:id" element={<DealOverviewPage />} />
                    <Route path="/deals/:id/data" element={<DealDataEntryPage />} />
                  </Route>

                  {/* CSR-only routes - creating deals */}
                  <Route element={<RoleGuard requiredRoles={['csr', 'admin']} blockExternalUsers />}>
                    <Route path="/deals/new" element={<CreateDealPage />} />
                    <Route path="/event-journal" element={<GlobalEventJournalPage />} />
                    <Route path="/deals/:id/edit" element={<DealDataEntryPage />} />
                    <Route path="/users" element={<UsersPage />} />
                    <Route path="/documents" element={<DocumentsPage />} />
                  </Route>

                  {/* Deal Documents - accessible by CSR and Admin */}
                  <Route element={<RoleGuard requiredRoles={['csr', 'admin']} />}>
                    <Route path="/deals/:id/documents" element={<DealDocumentsPage />} />
                  </Route>

                  {/* Admin routes */}
                  <Route element={<RoleGuard requiredRoles={['admin']} blockExternalUsers />}>
                    <Route path="/admin/config" element={<ConfigurationPage />} />
                    <Route path="/admin/users" element={<UserManagementPage />} />
                    <Route path="/admin/templates" element={<TemplateManagementPage />} />
                    <Route path="/admin/packets" element={<PacketManagementPage />} />
                    <Route path="/admin/fields" element={<FieldDictionaryPage />} />
                    <Route path="/admin/field-maps" element={<FieldMapEditorPage />} />
                    <Route path="/admin/settings" element={<SystemSettingsPage />} />
                    <Route path="/admin/permissions" element={<PermissionManagementPage />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </SidebarProvider>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
