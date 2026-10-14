import { Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import './TopBar.css';

export default function TopBar({ onOpenMobileMenu }) {
  const location = useLocation();

  const getPageTitle = (path) => {
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
        <div className="topbar-breadcrumb">
          <span className="crumb-root">Workspace</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">{pageTitle}</span>
        </div>
      </div>

      <div className="topbar-right">
        <div className="status-dot-badge">
          <span className="dot-live" />
          <span className="dot-label">Active Bench</span>
        </div>
        <div className="topbar-avatar" title="Signed in as John Doe">
          JD
        </div>
      </div>
    </header>
  );
}
