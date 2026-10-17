import { NavLink } from 'react-router-dom';
import { PlusCircle, FolderGit2, Users, History, X } from 'lucide-react';
import LogoMotion from './LogoMotion';
import ThemeToggle from './ThemeToggle';
import './Sidebar.css';

export default function Sidebar({ isOpen, onClose }) {
  const navItems = [
    { to: '/app', label: 'New trial', icon: PlusCircle, end: true },
    { to: '/app/repo', label: 'Repo audit', icon: FolderGit2, end: false },
    { to: '/app/agents', label: 'Agents', icon: Users, end: false },
    { to: '/app/history', label: 'Case history', icon: History, end: false },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
        {/* Brand header */}
        <div className="sidebar-brand">
          <NavLink to="/" className="sidebar-brand-link" onClick={onClose}>
            <LogoMotion variant="mark-only" size="default" />
            <div className="brand-text-col">
              <span className="brand-name">Verdict AI</span>
              <span className="brand-badge">Where bugs get a fair trial</span>
            </div>
          </NavLink>

          {/* Close button for mobile drawer */}
          <button
            type="button"
            className="mobile-close-btn"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="sidebar-nav">
          <div className="nav-section-title">Navigation</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `sidebar-nav-item ${isActive ? 'active' : ''}`
                }
                onClick={onClose}
              >
                <Icon size={18} className="nav-icon" />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="user-profile-chip">
            <div className="user-avatar-circle">JD</div>
            <div className="user-meta">
              <span className="user-name">John Doe</span>
              <span className="user-role">Developer</span>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
