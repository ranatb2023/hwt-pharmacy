import React, { Component } from 'react';

// One broken page must not white-screen the counter. React unmounts the whole
// tree when a render or effect throws and nothing catches it; this catches it
// at the route, shows a plain message, and resets when the route changes
// (`resetKey` is the pathname) so the next screen gets a clean start.
export default class RouteErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('Route error:', error);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <p className="font-semibold text-slate-900 m-0">This page hit an error.</p>
        <p className="text-xs text-slate-500 mt-1 mb-0 font-mono break-words">{String(this.state.error?.message || this.state.error)}</p>
        <button type="button" className="ws-btn mt-3" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
