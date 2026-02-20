import { useState, useEffect, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setCountdown(30);
    window.location.reload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header style={headerStyle}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>NextHello Admin</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Auto-refresh in {countdown}s
          </span>
          <button onClick={handleRefresh} style={refreshBtnStyle}>
            Refresh
          </button>
        </div>
      </header>

      <nav style={tabsStyle}>
        <TabLink to="/">Overview</TabLink>
        <TabLink to="/swarm">Swarm</TabLink>
        <TabLink to="/contacts">Contacts</TabLink>
        <TabLink to="/settings">Settings</TabLink>
      </nav>

      <main style={{ flex: 1, padding: '0 1rem 1rem' }}>{children}</main>

      <footer style={footerStyle}>NextHello Admin Dashboard</footer>
    </div>
  );
}

interface TabLinkProps {
  to: string;
  children: ReactNode;
}

function TabLink({ to, children }: TabLinkProps) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      style={({ isActive }) => ({
        background: isActive ? 'var(--bg-secondary)' : 'transparent',
        border: '1px solid',
        borderColor: isActive ? 'var(--border)' : 'transparent',
        borderBottomColor: isActive ? 'var(--bg-secondary)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
        padding: '0.5rem 1rem',
        borderRadius: '6px 6px 0 0',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '0.875rem',
        marginBottom: isActive ? '-1px' : '0',
        transition: 'all 0.2s',
        textDecoration: 'none',
      })}
    >
      {children}
    </NavLink>
  );
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '1rem',
  borderBottom: '1px solid var(--border)',
  marginBottom: '1rem',
};

const refreshBtnStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '0.5rem 1rem',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginBottom: '1.5rem',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '0.5rem',
  paddingLeft: '1rem',
};

const footerStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '1rem',
  color: 'var(--text-muted)',
  fontSize: '0.75rem',
};
