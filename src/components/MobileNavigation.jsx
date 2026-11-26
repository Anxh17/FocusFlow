import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListTodo, BarChart3, Sparkles, Zap } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tasks', icon: ListTodo, label: 'Tasks' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/coach', icon: Sparkles, label: 'Coach' },
];

export default function MobileNavigation() {
  return (
    <>
      <header className="mobile-header">
        <div className="mobile-header-logo">
          <Zap size={20} />
          FocusFlow
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <div className="mobile-nav-items">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `mobile-nav-link${isActive ? ' active' : ''}`}
              end={item.to === '/'}
            >
              <item.icon />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
