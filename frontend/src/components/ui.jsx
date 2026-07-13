import React from 'react';

export function money(n) {
  return 'Rs ' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function CategoryBadge({ category }) {
  const map = {
    'Paid': 'gray',
    'Complete Free': 'green',
    'Discounted': 'amber',
    'Staff': 'blue',
  };
  return <span className={`badge ${map[category] || 'gray'}`}>{category}</span>;
}

export function StatusBadge({ status }) {
  const map = {
    waiting: 'amber', serving: 'blue', done: 'green', cancelled: 'red',
    ordered: 'amber', collected: 'blue', completed: 'green',
    registered: 'gray', 'in-consultation': 'blue', lab: 'amber', pharmacy: 'teal', billed: 'green',
    unpaid: 'red', partial: 'amber', paid: 'green',
  };
  return <span className={`badge ${map[status] || 'gray'}`}>{status}</span>;
}

export function Alert({ type = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`alert ${type === 'error' ? 'err' : type}`}>
      <span>{children}</span>
      {onClose && <a style={{ float: 'right' }} onClick={onClose}>✕</a>}
    </div>
  );
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}
