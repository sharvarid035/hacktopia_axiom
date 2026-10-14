import { useState } from 'react';
import { Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { ThemeProvider } from './hooks/ThemeProvider';
import { useSwarmStream } from './hooks/useSwarmStream';
import { useRepoStream } from './hooks/useRepoStream';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Landing from './pages/Landing';
import NewTrial from './pages/NewTrial';
import RepoAudit from './pages/RepoAudit';
import Agents from './pages/Agents';
import History from './pages/History';
import './App.css';

function AppShellLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="app-shell-root">
      {/* Persistent Left Sidebar */}
      <Sidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content Area */}
      <div className="app-main-viewport">
        <TopBar onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main className="app-content-container">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const swarmState = useSwarmStream();
  const repoState = useRepoStream();

  return (
    <ThemeProvider>
      <Routes>
        {/* 1. Landing Page */}
        <Route path="/" element={<Landing />} />

        {/* 2. App Shell */}
        <Route path="/app" element={<AppShellLayout />}>
          <Route index element={<NewTrial swarmState={swarmState} />} />
          <Route path="repo" element={<RepoAudit repoState={repoState} />} />
          <Route path="agents" element={<Agents />} />
          <Route path="history" element={<History swarmState={swarmState} repoState={repoState} />} />
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
