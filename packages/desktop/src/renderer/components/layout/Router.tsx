import React, { Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
import { ipcBridge } from '@/common';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const MobileConversation = React.lazy(() => import('@renderer/pages/mobile-conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const AssistantSettings = React.lazy(() => import('@renderer/pages/settings/AssistantSettings'));
const CapabilitiesSettings = React.lazy(() => import('@renderer/pages/settings/CapabilitiesSettings'));
const DisplaySettings = React.lazy(() => import('@renderer/pages/settings/DisplaySettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));
const PetSettings = React.lazy(() => import('@renderer/pages/settings/PetSettings'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const TeamIndex = React.lazy(() => import('@renderer/pages/team'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return children;
};

const isRemoteWebRuntime = (): boolean => {
  return typeof window !== 'undefined' && !window.electronAPI;
};

const MobileEntryRoute: React.FC = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const openLatestMobileConversation = async () => {
      try {
        const result = await ipcBridge.database.getUserConversations.invoke({ limit: 1 });
        const latestId = result.items?.[0]?.id;
        if (!cancelled && latestId) {
          void navigate(`/mobile/conversation/${latestId}`, { replace: true });
          return;
        }
      } catch (error) {
        console.error('[MobileEntryRoute] Failed to load latest conversation:', error);
      }

      if (!cancelled) setReady(true);
    };

    void openLatestMobileConversation();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!ready) return <AppLoader />;
  return withRouteFallback(MobileConversation);
};

const HomeRoute: React.FC = () => {
  if (isRemoteWebRuntime()) {
    return <Navigate to='/mobile' replace />;
  }
  return <Navigate to='/guid' replace />;
};

const GuidRoute: React.FC = () => {
  if (isRemoteWebRuntime()) {
    return <Navigate to='/mobile' replace />;
  }
  return withRouteFallback(Guid);
};

const ConversationRoute: React.FC = () => {
  const { id } = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);

  if (isRemoteWebRuntime() && searchParams.get('desktop') !== '1' && id) {
    return <Navigate to={`/mobile/conversation/${id}`} replace />;
  }

  return withRouteFallback(Conversation);
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route
          path='/mobile/conversation/:id'
          element={<ProtectedRoute>{withRouteFallback(MobileConversation)}</ProtectedRoute>}
        />
        <Route
          path='/mobile'
          element={
            <ProtectedRoute>
              <MobileEntryRoute />
            </ProtectedRoute>
          }
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<HomeRoute />} />
          <Route path='/guid' element={<GuidRoute />} />
          <Route path='/conversation/:id' element={<ConversationRoute />} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/settings/assistants' element={withRouteFallback(AssistantSettings)} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/capabilities' element={withRouteFallback(CapabilitiesSettings)} />
          {/* Legacy routes — redirect to the merged /settings/capabilities page */}
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/capabilities?tab=skills' replace />} />
          <Route path='/settings/tools' element={<Navigate to='/settings/capabilities?tab=tools' replace />} />
          <Route path='/settings/display' element={withRouteFallback(DisplaySettings)} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/pet' element={withRouteFallback(PetSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/model' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
