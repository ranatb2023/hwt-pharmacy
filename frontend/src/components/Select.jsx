import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from './icons.jsx';

// Recursively extract the plain-text label from an <option>'s children
// (handles strings, numbers and interpolated expressions like `a · b · c`).
function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props && node.props.children != null) return textOf(node.props.children);
  return '';
}

// Flatten <option> children (including arrays from .map / <optgroup>) into a list.
function collectOptions(children) {
  const out = [];
  React.Children.forEach(children, (child) => {
    if (!child || typeof child !== 'object') return;
    if (Array.isArray(child)) { out.push(...collectOptions(child)); return; }
    if (child.type === 'option') {
      const label = textOf(child.props.children);
      const value = child.props.value !== undefined ? child.props.value : label;
      out.push({ value: String(value), label, disabled: !!child.props.disabled });
    } else if (child.props && child.props.children) {
      out.push(...collectOptions(child.props.children));
    }
  });
  return out;
}

// A styled, accessible drop-in replacement for a native <select>. Keeps the
// same API: `value`, `onChange` (receives a synthetic { target: { value } }),
// and <option> children. Fully stylable open list, keyboard + click-outside.
export function Select({ value, onChange, children, disabled, id, className = '', style, required, title, placeholder }) {
  const options = collectOptions(children);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const sval = value == null ? '' : String(value);
  const current = options.find((o) => o.value === sval);
  const label = current ? current.label : (placeholder || '');

  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, close]);

  // On open, highlight the currently-selected option.
  useEffect(() => {
    if (open) {
      const i = options.findIndex((o) => o.value === sval);
      setActive(i >= 0 ? i : 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (open && listRef.current && active >= 0) {
      const el = listRef.current.children[active];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }, [active, open]);

  function pick(opt) {
    if (!opt || opt.disabled) return;
    if (onChange) onChange({ target: { value: opt.value } });
    close();
  }

  function move(dir) {
    setActive((a) => {
      let i = a;
      for (let step = 0; step < options.length; step++) {
        i = (i + dir + options.length) % options.length;
        if (!options[i].disabled) return i;
      }
      return a;
    });
  }

  function onKey(e) {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active]); }
  }

  return (
    <div ref={rootRef} className={`sel ${disabled ? 'is-disabled' : ''} ${className}`.trim()} style={style}>
      <button
        type="button" id={id} title={title} disabled={disabled}
        className={`sel-trigger ${open ? 'open' : ''}`}
        aria-haspopup="listbox" aria-expanded={open} aria-required={required || undefined}
        onClick={() => !disabled && setOpen((o) => !o)} onKeyDown={onKey}
      >
        <span className={`sel-value ${!current ? 'is-placeholder' : ''}`}>{label || ' '}</span>
        <span className="sel-arrow"><Icon name="chevrondown" size={18} /></span>
      </button>
      {open && (
        <ul ref={listRef} className="sel-menu" role="listbox">
          {options.map((o, i) => (
            <li
              key={o.value + '::' + i} role="option" aria-selected={o.value === sval}
              className={`sel-opt ${o.value === sval ? 'selected' : ''} ${i === active ? 'active' : ''} ${o.disabled ? 'disabled' : ''}`.trim()}
              onMouseEnter={() => !o.disabled && setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              <span className="sel-opt-label">{o.label}</span>
              {o.value === sval && <Icon name="check" size={16} />}
            </li>
          ))}
          {options.length === 0 && <li className="sel-opt disabled">No options</li>}
        </ul>
      )}
    </div>
  );
}

export default Select;
