import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import MobileNavigation from './MobileNavigation.jsx';

export default function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <MobileNavigation />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
