import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { applyTheme, getTheme } from './theme.js';
import { useAuth, isReceptionOnly, isDoctorHub, isLabHub, isPharmacyHub, isCashierHub, isHubUser, isManagementUser } from './auth.jsx';
import Layout from './components/Layout.jsx';
import HubLayout from './components/HubLayout.jsx';
import WsLayout from './components/WsLayout.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ReceptionHome from './pages/ReceptionHome.jsx';
import DoctorHome from './pages/DoctorHome.jsx';
import LabHome from './pages/LabHome.jsx';
import PharmacyHome from './pages/PharmacyHome.jsx';
import PharmacyClose from './pages/PharmacyClose.jsx';
import CashierHome from './pages/CashierHome.jsx';
import Patients from './pages/Patients.jsx';
import PatientDetail from './pages/PatientDetail.jsx';
import RegisterPatient from './pages/RegisterPatient.jsx';
import Queue from './pages/Queue.jsx';
import Consultation from './pages/Consultation.jsx';
import Lab from './pages/Lab.jsx';
import Pharmacy from './pages/Pharmacy.jsx';
import Inventory from './pages/Inventory.jsx';
import Billing from './pages/Billing.jsx';
import Vendors from './pages/Vendors.jsx';
import Departments from './pages/Departments.jsx';
import Customers from './pages/Customers.jsx';
import Credit from './pages/Credit.jsx';
import Margin from './pages/Margin.jsx';
import Amend from './pages/Amend.jsx';
import Returns from './pages/Returns.jsx';
import Dialysis from './pages/Dialysis.jsx';
import CashFlow from './pages/CashFlow.jsx';
import Reports from './pages/Reports.jsx';
import Admin from './pages/Admin.jsx';
import StockAudit from './pages/StockAudit.jsx';
import DonorPortal from './pages/portal/DonorPortal.jsx';
import PatientPortal from './pages/portal/PatientPortal.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Role-focused users get a simplified home hub; everyone else gets the
// management dashboard.
function Home() {
  const { user, hospitalMode } = useAuth();
  // Pharmacy mode: a management user's home is the Management Dashboard (the
  // executive-dashboard mockup, in the sidebar frame); a counter user's home
  // is the pharmacy dashboard in the dock frame. The role hubs are the
  // hospital module's.
  if (!hospitalMode) return <Dashboard management={isManagementUser(user)} />;
  if (isReceptionOnly(user)) return <ReceptionHome />;
  if (isDoctorHub(user)) return <DoctorHome />;
  if (isLabHub(user)) return <LabHome />;
  if (isPharmacyHub(user)) return <PharmacyHome />;
  if (isCashierHub(user)) return <CashierHome />;
  return <Dashboard />;
}

// Which frame the pages sit in.
//
// Pharmacy mode — every install this product has today — gets the workstation
// shell from Phase 09: header, Alt-dock, footer, no sidebar, permission-filtered
// so an administrator and a counter pharmacist see the same frame with
// different destinations. Hospital mode keeps the older shells, because the
// on-hold clinical screens have not been restyled and should not look like they
// were. All three render an <Outlet/>, so the routes are shared.
// Phase 10 splits pharmacy mode into two frames, chosen by ROUTE: the counter
// screens keep the header-and-dock frame (the 17 pharmacy_pos_* mockups), the
// management screens get the sidebar frame (the executive dashboard and the 42
// pharmacy_admin_* mockups). A management user's home is the dashboard in the
// sidebar; a counter hub user's home stays in the dock. The sidebar links to
// the counter screens and the dock's More menu links back — one page tree,
// two frames, never both.
// Only the admin-only screens force the sidebar frame (mobile spec, item 8):
// a pharmacist opening Stock Audit or Dialysis stays in the dock they came from.
const SIDEBAR_ROUTES = ['/admin', '/reports', '/margin', '/amend'];
function Shell() {
  const { user, hospitalMode, config } = useAuth();
  // The browser tab names the pharmacy, not the hospital product (QA S4-38).
  useEffect(() => { document.title = config?.pharmacy_name || 'Hope Welfare Trust Pharmacy'; }, [config?.pharmacy_name]);
  useEffect(() => { applyTheme(getTheme()); }, []);
  const { pathname } = useLocation();
  if (hospitalMode) return isHubUser(user) ? <HubLayout /> : <Layout />;
  // A management user lives in the sidebar frame on every screen — the 42
  // admin mockups and the executive dashboard (Phase 11); the counter pages
  // take the admin skin there. A counter user has the dock everywhere except
  // the report / admin routes, which only exist in the sidebar frame.
  const sidebar = isManagementUser(user)
    || SIDEBAR_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  return sidebar ? <AdminLayout /> : <WsLayout />;
}

// Clinical billing (Stitch screen 16) belongs to the hospital module, which is
// on hold. In pharmacy mode it has no dock entry and, since Phase 09, no route
// either — a typed URL lands on the home page rather than an unstyled screen.
// The old pharmacy dashboard URL: the Management Dashboard now, in pharmacy
// mode; the hub page stays for hospital mode.
function PharmacyDashboardRoute() {
  const { hospitalMode } = useAuth();
  return hospitalMode ? <PharmacyHome /> : <Navigate to="/" replace />;
}

function HospitalOnly({ children }) {
  const { hospitalMode } = useAuth();
  return hospitalMode ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/portal/donor" element={<DonorPortal />} />
      <Route path="/portal/patient" element={<PatientPortal />} />
      <Route
        path="/"
        element={
          <Protected>
            <Shell />
          </Protected>
        }
      >
        <Route index element={<Home />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/new" element={<RegisterPatient />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="queue" element={<Queue />} />
        <Route path="consultation/:visitId" element={<Consultation />} />
        <Route path="lab" element={<Lab />} />
        <Route path="pharmacy" element={<Pharmacy />} />
        <Route path="pharmacy-dashboard" element={<PharmacyDashboardRoute />} />
        <Route path="pharmacy-close" element={<PharmacyClose />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="billing" element={<HospitalOnly><Billing /></HospitalOnly>} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="departments" element={<Departments />} />
        <Route path="customers" element={<Customers />} />
        <Route path="credit" element={<Credit />} />
        <Route path="margin" element={<Margin />} />
        <Route path="amend" element={<Amend />} />
        <Route path="returns" element={<Returns />} />
        <Route path="dialysis" element={<Dialysis />} />
        <Route path="cashflow" element={<CashFlow />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/:key" element={<Reports />} />
        <Route path="stock-audit" element={<StockAudit />} />
        <Route path="admin" element={<Admin />} />
        <Route path="admin/:tab" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to={loading ? '/login' : '/'} replace />} />
    </Routes>
  );
}
