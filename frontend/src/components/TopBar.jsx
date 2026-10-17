import { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { useLocation, Link } from 'react-router-dom';
import { BACKEND_URL } from '../hooks/useSwarmStream';
import './TopBar.css';

export default function TopBar({ onOpenMobileMenu }) {
  const location = useLocation();
  const [backendStatus, setBackendStatus] = useState('checking');

  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          if (isMounted) setBackendStatus('connected');
        } else {
          if (isMounted) setBackendStatus('offline');
        }
      } catch {
        if (isMounted) setBackendStatus('offline');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const getPageTitle = (path) => {
    if (path === '/app/repo') return 'Repo audit';
    if (path === '/app/agents') return 'Agents';
    if (path === '/app/history') return 'Case history';
    return 'New trial';
  };

  const pageTitle = getPageTitle(location.pathname);

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onOpenMobileMenu}
          aria-label="Open sidebar menu"
        >
          <Menu size={22} />
        </button>
        <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
          <Link to="/app" className="crumb-root">Workspace</Link>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb-current" aria-current="page">{pageTitle}</span>
        </nav>
      </div>

      <div className="topbar-right">
        {backendStatus !== 'checking' && (
          <div
            className={`status-dot-badge status-${backendStatus}`}
            title={backendStatus === 'connected' ? 'Backend connected' : 'Backend offline'}
          >
            <span className={backendStatus === 'connected' ? 'dot-live' : 'dot-offline'} />
            <span className="dot-label">
              {backendStatus === 'connected' ? 'Backend connected' : 'Backend offline'}
            </span>
          </div>
        )}
        <div className="topbar-avatar" title="Signed in as John Doe">
          JD
        </div>
      </div>
    </header>
  );
}
