import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, KeyRound, Plug, ShieldAlert, XCircle } from 'lucide-react';
import type { ApiConfigurationStatus, OrganizationSettings } from '@nova/shared';
import { ApiError, api } from '../../lib/api';
import { useQuery } from '../../lib/queries';
import { useAuth } from '../../context/AuthContext';
import {
  Badge, Button, Card, CardHeader, Field, InlineNotice, Input, PageHeader, Skeleton, Switch, useToast,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';

interface SettingsResponse {
  organization: { id: string; name: string; settings: OrganizationSettings };
  apiConfiguration: ApiConfigurationStatus;
}

export function AdminSettingsPage() {
  const toast = useToast();
  const { refresh } = useAuth();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<SettingsResponse>('/admin/settings'),
  });

  const [name, setName] = useState('');
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingApi, setSavingApi] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.organization.name);
    setSettings(data.organization.settings);
    setBaseUrl(data.apiConfiguration.baseUrl);
  }, [data]);

  async function saveOrganization() {
    if (!settings) return;
    setSavingOrg(true);
    try {
      await api.patch('/admin/settings', { name, settings });
      toast.success('Parametres enregistres');
      void refetch();
      void refresh();
    } catch (err) {
      toast.error('Enregistrement impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingOrg(false);
    }
  }

  async function saveApiConfiguration(clear = false) {
    setSavingApi(true);
    try {
      await api.put('/admin/api-configuration', {
        apiKey: clear ? null : apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      setApiKey('');
      toast.success(clear ? 'Cle API supprimee' : 'Configuration enregistree');
      void refetch();
    } catch (err) {
      toast.error('Enregistrement impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingApi(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const response = await api.post<{ result: { ok: boolean; message: string } }>('/admin/api-configuration/test');
      if (response.result.ok) toast.success('Connexion etablie', response.result.message);
      else toast.error('Connexion impossible', response.result.message);
      void refetch();
    } catch (err) {
      toast.error('Test impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setTesting(false);
    }
  }

  if (isLoading || !settings || !data) {
    return (
      <>
        <PageHeader title="Parametres" />
        <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      </>
    );
  }

  const config = data.apiConfiguration;

  return (
    <>
      <PageHeader title="Parametres" description="Configuration globale de la plateforme." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organisation" icon={<Building2 className="size-4" />} />
          <div className="space-y-4 p-5">
            <Field label="Nom de l'organisation" htmlFor="org-name">
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <Field
              label="Credits attribues aux nouveaux collaborateurs"
              hint="Valeur proposee par defaut a la creation d'une invitation."
              htmlFor="default-credits"
            >
              <Input
                id="default-credits" type="number" min={0} value={settings.defaultCollaboratorCredits}
                onChange={(e) => setSettings({ ...settings, defaultCollaboratorCredits: Number(e.target.value) })}
              />
            </Field>

            <Field
              label="Generations simultanees par collaborateur"
              hint="Limite le nombre de generations en cours pour un meme utilisateur."
              htmlFor="max-concurrent"
            >
              <Input
                id="max-concurrent" type="number" min={1} max={50} value={settings.maxConcurrentGenerationsPerUser}
                onChange={(e) => setSettings({ ...settings, maxConcurrentGenerationsPerUser: Number(e.target.value) })}
              />
            </Field>

            <Field label="Taille maximale d'un fichier (Mo)" htmlFor="max-upload">
              <Input
                id="max-upload" type="number" min={1} max={200} value={settings.maxUploadSizeMb}
                onChange={(e) => setSettings({ ...settings, maxUploadSizeMb: Number(e.target.value) })}
              />
            </Field>

            <Switch
              checked={settings.invitationsEnabled}
              onChange={(value) => setSettings({ ...settings, invitationsEnabled: value })}
              label="Autoriser la creation de comptes par invitation"
              description="Desactive, aucun nouveau compte ne peut etre cree, meme avec un lien valide."
            />

            <Switch
              checked={settings.allowOverdraftByDefault}
              onChange={(value) => setSettings({ ...settings, allowOverdraftByDefault: value })}
              label="Autoriser le decouvert par defaut"
              description="Les nouveaux comptes pourront lancer une generation malgre un solde insuffisant."
            />

            <Button loading={savingOrg} onClick={saveOrganization}>Enregistrer</Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Connexion KIE.ai"
            description="Acces aux modeles IA"
            icon={<Plug className="size-4" />}
            action={
              config.configured ? (
                <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>Configuree</Badge>
              ) : (
                <Badge tone="danger" icon={<XCircle className="size-3" />}>Non configuree</Badge>
              )
            }
          />
          <div className="space-y-4 p-5">
            <InlineNotice
              tone="info"
              title="La cle ne quitte jamais le serveur"
              icon={<ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--info)]" />}
            >
              Elle est chiffree (AES-256-GCM) avant d'etre stockee et n'est jamais renvoyee a
              l'interface. Tous les appels aux modeles sont effectues par l'API.
            </InlineNotice>

            {!config.configured ? (
              <InlineNotice tone="warning" title="Aucune cle enregistree">
                Les generations echoueront tant qu'aucune cle valide n'est fournie. Les credits
                reserves sont automatiquement rembourses dans ce cas.
              </InlineNotice>
            ) : null}

            <Field
              label="Cle API"
              hint={config.keyLast4 ? `Cle actuelle : ••••${config.keyLast4}. Laissez vide pour la conserver.` : undefined}
              htmlFor="api-key"
            >
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config.keyLast4 ? '••••••••••••' : 'Collez votre cle KIE.ai'}
                autoComplete="off"
              />
            </Field>

            <Field label="URL de base de l'API" htmlFor="base-url">
              <Input id="base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </Field>

            {config.lastCheckAt ? (
              <p className="text-[12px] text-muted-fg">
                Dernier test : {formatDateTime(config.lastCheckAt)} —{' '}
                <span className={config.lastCheckStatus === 'ok' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                  {config.lastCheckMessage}
                </span>
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button loading={savingApi} icon={<KeyRound className="size-4" />} onClick={() => saveApiConfiguration(false)}>
                Enregistrer
              </Button>
              <Button variant="secondary" loading={testing} onClick={testConnection}>
                Tester la connexion
              </Button>
              {config.keyLast4 ? (
                <Button variant="ghost" onClick={() => saveApiConfiguration(true)}>Supprimer la cle</Button>
              ) : null}
            </div>

            <p className="text-[12px] text-muted-fg">
              Mise a jour {formatDateTime(config.updatedAt)}
              {config.updatedByName ? ` par ${config.updatedByName}` : ''}.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
