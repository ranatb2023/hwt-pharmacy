import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(username, password) {
    const r = await api.post('/auth/login', { username, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }

  function logout() {
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  }

  const can = (perm) => !!user && user.permissions.includes(perm);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// A "reception-focused" user registers/routes patients but does no clinical,
// pharmacy, cash or admin work. These users get the simplified reception shell
// (top bar + four-option hub) instead of the full sidebar application.
export function isReceptionOnly(user) {
  if (!user) return false;
  const has = (p) => user.permissions?.includes(p);
  return (
    has('patient.manage') && !has('consult.manage') && !has('pharmacy.sell') &&
    !has('lab.manage') && !has('cash.manage') && !has('user.manage')
  );
}

// A "doctor" user runs consultations (EMR) but does no pharmacy/cash/admin work.
// They get the same clean hub shell as reception, with a doctor-specific home.
export function isDoctorHub(user) {
  if (!user) return false;
  const has = (p) => user.permissions?.includes(p);
  return (
    has('consult.manage') && !has('pharmacy.sell') && !has('cash.manage') && !has('user.manage')
  );
}

// Lab technician: records lab results (lab.manage) but no consultation/admin.
export function isLabHub(user) {
  if (!user) return false;
  const has = (p) => user.permissions?.includes(p);
  return has('lab.manage') && !has('consult.manage') && !has('user.manage');
}

// Pharmacist: dispenses/sells (pharmacy.sell), broad but not admin.
export function isPharmacyHub(user) {
  if (!user) return false;
  const has = (p) => user.permissions?.includes(p);
  return has('pharmacy.sell') && !has('user.manage');
}

// Cashier: manages cash/billing but not pharmacy dispensing or clinical work.
export function isCashierHub(user) {
  if (!user) return false;
  const has = (p) => user.permissions?.includes(p);
  return has('cash.manage') && !has('pharmacy.sell') && !has('consult.manage') && !has('user.manage');
}

// Any role-focused user that gets the simplified top-bar hub instead of the
// full sidebar application (admin keeps the full dashboard/sidebar).
export function isHubUser(user) {
  return isReceptionOnly(user) || isDoctorHub(user) || isLabHub(user) ||
    isPharmacyHub(user) || isCashierHub(user);
}
