import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListTodo, BarChart3, Sparkles, Zap } from 'lucide-react';
import { isDemoMode } from '../services/demoService.js';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tasks', icon: ListTodo, label: 'Tasks' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/coach', icon: Sparkles, label: 'Coach' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-logo">
        <Zap size={22} />
        FocusFlow
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            end={item.to === '/'}
          >
            <item.icon />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        {isDemoMode() && (
          <div className="badge badge-info" style={{ marginBottom: 8 }}>
            Sample Demo Active
          </div>
        )}
        <div className="text-sm text-muted">Your plans should adapt to your life.</div>
      </div>
    </aside>
  );
}
