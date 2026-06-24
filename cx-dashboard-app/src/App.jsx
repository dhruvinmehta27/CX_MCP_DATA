import { useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import FilterBar from './components/layout/FilterBar';
import ErrorBoundary from './components/ui/ErrorBoundary';
import AccessGate from './auth/AccessGate';
import { FilterProvider } from './hooks/useFilters';
import Dashboard from './pages/Dashboard';
import DailyBriefing from './pages/DailyBriefing';
import QuoteAnalytics from './pages/QuoteAnalytics';
import PipelineBoard from './pages/PipelineBoard';
import PipelineHealth from './pages/PipelineHealth';
import RFQTracker from './pages/RFQTracker';
import CustomBuilder from './pages/CustomBuilder';
import SalesBrief from './pages/SalesBrief';

const PAGE_TITLES = {
  '/': ['Dashboard', 'Select a section to get started'],
  '/briefing': ['Daily Briefing', "Today's snapshot across quotes, pipeline, RFQs and tasks"],
  '/quotes': ['Quote Analytics', 'Full quote analysis'],
  '/board': ['Pipeline Command Center', 'Kanban, funnel, forecast and flow — one shared filter set'],
  '/pipeline': ['Pipeline Health', 'Opportunity pipeline analysis'],
  '/rfqs': ['RFQ Tracker', 'Request-for-quote status and due dates'],
  '/builder': ['AI Report Builder', 'Describe a report in plain English'],
  '/brief': ['Sales Brief', 'Audience-tailored, print-ready briefing'],
};

function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  // The welcome / launchpad is a full-screen page with NO app chrome — the
  // sidebar + filter bar only appear once the user picks a section.
  if (location.pathname === '/') {
    return <Dashboard />;
  }

  const [title, subtitle] = PAGE_TITLES[location.pathname] || ['Dashboard', ''];

  return (
    <div className="app-shell">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className={`main-area${collapsed ? ' sidebar-collapsed' : ''}`}>
        <Header title={title} subtitle={subtitle} />
        <FilterBar />
        <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/briefing" element={<DailyBriefing />} />
            <Route path="/quotes" element={<QuoteAnalytics />} />
            <Route path="/board" element={<PipelineBoard />} />
            <Route path="/pipeline" element={<PipelineHealth />} />
            <Route path="/rfqs" element={<RFQTracker />} />
            <Route path="/builder" element={<CustomBuilder />} />
            <Route path="/brief" element={<SalesBrief />} />
          </Routes>
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <FilterProvider>
        <AccessGate>
          <Shell />
        </AccessGate>
      </FilterProvider>
    </BrowserRouter>
  );
}
