import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/auth/Login';
import { RegisterPage } from './pages/auth/Register';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/Password';
import { DashboardPage } from './pages/Dashboard';
import { GeneratePage } from './pages/Generate';
import { GalleryPage } from './pages/Gallery';
import { ModelsPage } from './pages/Models';
import { WorkflowsPage } from './pages/Workflows';
import { HistoryPage } from './pages/History';
import { ProfilePage } from './pages/Profile';
import { AdminOverviewPage } from './pages/admin/Overview';
import { AdminUsersPage } from './pages/admin/Users';
import { AdminCreditsPage } from './pages/admin/Credits';
import { AdminActivityPage } from './pages/admin/Activity';
import { AdminModelsPage } from './pages/admin/Models';
import { AdminSettingsPage } from './pages/admin/Settings';
import { Card, EmptyState, Button } from './components/ui';

function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-[var(--accent)]" aria-label="Chargement" />
    </div>
  );
}

/** Garde d'authentification. Le serveur applique la meme regle sur chaque route API. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Garde de role. Le controle effectif reste cote serveur (403 sur l'API). */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!isAdmin) {
    return (
      <Card>
        <EmptyState
          title="Acces reserve aux administrateurs"
          description="Cette section n'est pas accessible avec votre role."
          action={<Button onClick={() => window.history.back()}>Retour</Button>}
        />
      </Card>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/inscription" element={<RegisterPage />} />
      <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="/generation" element={<GeneratePage />} />
        <Route path="/audio" element={<GeneratePage restrictKind="audio" />} />
        <Route path="/galerie" element={<GalleryPage />} />
        <Route path="/modeles" element={<ModelsPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/historique" element={<HistoryPage />} />
        <Route path="/profil" element={<ProfilePage />} />

        <Route path="/admin" element={<RequireAdmin><AdminOverviewPage /></RequireAdmin>} />
        <Route path="/admin/collaborateurs" element={<RequireAdmin><AdminUsersPage /></RequireAdmin>} />
        <Route path="/admin/credits" element={<RequireAdmin><AdminCreditsPage /></RequireAdmin>} />
        <Route path="/admin/journal" element={<RequireAdmin><AdminActivityPage /></RequireAdmin>} />
        <Route path="/admin/modeles" element={<RequireAdmin><AdminModelsPage /></RequireAdmin>} />
        <Route path="/admin/parametres" element={<RequireAdmin><AdminSettingsPage /></RequireAdmin>} />

        <Route
          path="*"
          element={
            <Card>
              <EmptyState
                title="Page introuvable"
                description="Le lien demande n'existe pas ou a ete deplace."
                action={<Button onClick={() => window.history.back()}>Retour</Button>}
              />
            </Card>
          }
        />
      </Route>
    </Routes>
  );
}
