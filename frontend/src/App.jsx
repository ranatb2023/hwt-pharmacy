import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, isReceptionOnly, isDoctorHub, isLabHub, isPharmacyHub, isCashierHub, isHubUser } from './auth.jsx';
import Layout from './components/Layout.jsx';
import HubLayout from './components/HubLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ReceptionHome from './pages/ReceptionHome.jsx';
import DoctorHome from './pages/DoctorHome.jsx';
import LabHome from './pages/LabHome.jsx';
import PharmacyHome from './pages/PharmacyHome.jsx';
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
import Returns from './pages/Returns.jsx';
import Dialysis from './pages/Dialysis.jsx';
import CashFlow from './pages/CashFlow.jsx';
import Reports from './pages/Reports.jsx';
import Admin from './pages/Admin.jsx';
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
  const { user } = useAuth();
  if (isReceptionOnly(user)) return <ReceptionHome />;
  if (isDoctorHub(user)) return <DoctorHome />;
  if (isLabHub(user)) return <LabHome />;
  if (isPharmacyHub(user)) return <PharmacyHome />;
  if (isCashierHub(user)) return <CashierHome />;
  return <Dashboard />;
}

// Reception and doctor users get a clean top-bar shell; all other roles keep the
// full sidebar application. Both render an <Outlet/>, so the routes are shared.
function Shell() {
  const { user } = useAuth();
  return isHubUser(user) ? <HubLayout /> : <Layout />;
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
        <Route path="inventory" element={<Inventory />} />
        <Route path="billing" element={<Billing />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="returns" element={<Returns />} />
        <Route path="dialysis" element={<Dialysis />} />
        <Route path="cashflow" element={<CashFlow />} />
        <Route path="reports" element={<Reports />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to={loading ? '/login' : '/'} replace />} />
    </Routes>
  );
}
