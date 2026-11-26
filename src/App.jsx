import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isOnboardingComplete } from './services/goalService.js';
import AppLayout from './components/AppLayout.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import Analytics from './pages/Analytics.jsx';
import Coach from './pages/Coach.jsx';
import './styles/global.css';

function ProtectedRoute({ children }) {
  if (!isOnboardingComplete()) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/coach" element={<Coach />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
