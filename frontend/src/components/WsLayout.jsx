import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useConnection } from '../connection.js';
import { WsHeader, WsNav, WsFooter, OfflineOverlay } from './ws/index.jsx';

// The workstation shell: header, nav dock, page, status footer — the frame every
// redesigned screen in hwt-client/design/stitch sits inside. No sidebar; the
// design gives the whole width to the work.
//
// Full height with the page area scrolling on its own, so the header, dock and
// footer stay put while a long cart or ledger scrolls beneath them. Pages that
// need their own internal panes (the POS) set their own height and overflow.
export default function WsLayout() {
  // A recovered connection remounts the page so it re-fetches (QA3 H2) —
  // except the counter, which keeps its basket and re-fetches on its own.
  const { epoch } = useConnection();
  const { pathname } = useLocation();
  return (
    <div className="h-screen flex flex-col bg-slate-100 text-slate-800 antialiased font-sans">
      <WsHeader />
      <WsNav />
      <OfflineOverlay />
      {/* `min-h-full flex flex-col` on the inner wrapper is what lets a page
          choose between two behaviours without the shell knowing which:
            - an ordinary page flows, grows past the fold, and <main> scrolls;
            - a workstation page (the POS) sets `flex-1 min-h-0` on its root,
              fills exactly the remaining height, and scrolls its own cart
              while the header, dock and footer stay put — the design's layout. */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-full flex flex-col p-3 ws-content"
          style={{ '--ctl-h': '2rem', '--ctl-fs': '12px', '--ctl-px': '8px', '--ctl-px-r': '6px', '--ctl-opt-py': '6px' }}>
          <Outlet key={pathname === '/pharmacy' ? 'pos' : `e${epoch}`} />
        </div>
      </main>
      <WsFooter />
    </div>
  );
}
