import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link nav-link--active' : 'nav-link';

export function Layout() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <p className="brand-title">Harbor Control</p>
            <p className="brand-sub">Team MCP gateway for store ops</p>
          </div>
        </div>
        <div className="header-user">
          <span className="user-pill">
            {user?.name}
            <span className="role-tag">{user?.role}</span>
          </span>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="app-body">
        <nav className="sidebar" aria-label="Main">
          <NavLink to="/chat" className={navLinkClass}>
            Chat
          </NavLink>
          <NavLink to="/stores" className={navLinkClass}>
            Stores
          </NavLink>
          <NavLink to="/team" className={navLinkClass}>
            Team &amp; keys
          </NavLink>
          <NavLink to="/servers" className={navLinkClass}>
            Servers &amp; status
          </NavLink>
          <NavLink to="/audit" className={navLinkClass}>
            Audit log
          </NavLink>
          {isAdmin && (
            <p className="nav-hint">Admin: manage servers and invite members on those pages.</p>
          )}
        </nav>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
