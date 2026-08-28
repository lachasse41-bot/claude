import { useEffect, useState } from 'react';
import {
  Building2, CheckCircle2, KeyRound, Mail, Plug, Send, ShieldAlert, XCircle,
} from 'lucide-react';
import type {
  ApiConfigurationStatus, EmailConfigurationStatus, EmailProvider, OrganizationSettings,
} from '@nova/shared';
import { ApiError, api } from '../../lib/api';
import { useQuery } from '../../lib/queries';
import { useAuth } from '../../context/AuthContext';
import {
  Badge, Button, Card, CardHeader, Field, InlineNotice, Input, PageHeader,
  SegmentedControl, Skeleton, Switch, useToast,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';

interface SettingsResponse {
  organization: { id: string; name: string; settings: OrganizationSettings };
  apiConfiguration: ApiConfigurationStatus;
  emailConfiguration: EmailConfigurationStatus;
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

        <EmailCard status={data.emailConfiguration} onSaved={() => void refetch()} />
      </div>
    </>
  );
}

/**
 * Configuration du service d'envoi.
 * Sans service configure, les invitations et les liens de reinitialisation
 * restent generes : ils doivent simplement etre transmis a la main.
 */
function EmailCard({
  status, onSaved,
}: { status: EmailConfigurationStatus; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    enabled: status.enabled,
    provider: status.provider,
    host: status.host,
    port: status.port,
    secure: status.secure,
    username: status.username,
    fromName: status.fromName,
    fromEmail: status.fromEmail,
    replyTo: status.replyTo,
  });
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testTo, setTestTo] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setForm({
      enabled: status.enabled,
      provider: status.provider,
      host: status.host,
      port: status.port,
      secure: status.secure,
      username: status.username,
      fromName: status.fromName,
      fromEmail: status.fromEmail,
      replyTo: status.replyTo,
    });
  }, [status]);

  async function save() {
    setSaving(true);
    setFields({});
    try {
      await api.put('/admin/email-configuration', {
        ...form,
        password: password.trim() ? password : undefined,
        apiKey: apiKey.trim() ? apiKey : undefined,
      });
      setPassword('');
      setApiKey('');
      toast.success('Configuration enregistree');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        toast.error(err.title, err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const response = await api.post<{
        result: { ok: boolean; message: string };
        delivery: { delivered: boolean; reason: string | null } | null;
      }>('/admin/email-configuration/test', { sendTo: testTo.trim() || undefined });

      if (!response.result.ok) toast.error('Connexion impossible', response.result.message);
      else if (response.delivery?.delivered) toast.success('E-mail de test envoye', `Destinataire : ${testTo}`);
      else if (response.delivery) toast.error('Envoi impossible', response.delivery.reason ?? undefined);
      else toast.success('Connexion etablie', response.result.message);
      onSaved();
    } catch (err) {
      toast.error('Test impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Envoi des e-mails"
        description="Invitations et reinitialisations de mot de passe"
        icon={<Mail className="size-4" />}
        action={
          status.configured ? (
            <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>
              {status.source === 'environment' ? "Via l'environnement" : 'Configuree'}
            </Badge>
          ) : (
            <Badge tone="warning" icon={<XCircle className="size-3" />}>Non configuree</Badge>
          )
        }
      />
      <div className="space-y-4 p-5">
        {!status.configured ? (
          <InlineNotice tone="info" title="Fonctionne aussi sans e-mail">
            Les invitations et les liens de reinitialisation restent generes et valides :
            le lien d'invitation s'affiche a la creation, et un lien de reinitialisation
            s'obtient depuis la fiche du collaborateur. Configurer un envoi automatique
            reste optionnel.
          </InlineNotice>
        ) : null}

        <Switch
          checked={form.enabled}
          onChange={(value) => setForm({ ...form, enabled: value })}
          label="Envoyer les e-mails depuis cette organisation"
          description="Desactive, la plateforme utilise la configuration d'environnement si elle existe."
        />

        <Field
          label="Mode d'envoi"
          hint="Les fournisseurs par API ne demandent qu'une cle : aucun serveur de messagerie a heberger."
        >
          <SegmentedControl
            value={form.provider}
            onChange={(value) => setForm({ ...form, provider: value as EmailProvider })}
            options={[
              { value: 'smtp', label: 'Relais SMTP' },
              { value: 'resend', label: 'Resend (API)' },
              { value: 'brevo', label: 'Brevo (API)' },
            ]}
          />
        </Field>

        {form.provider === 'smtp' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Serveur SMTP" error={fields.host} htmlFor="smtp-host">
                <Input
                  id="smtp-host" value={form.host} placeholder="smtp.exemple.com"
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </Field>
              <Field label="Port" hint="587 (STARTTLS) ou 465 (TLS implicite)" htmlFor="smtp-port">
                <Input
                  id="smtp-port" type="number" min={1} max={65535} value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                />
              </Field>
              <Field label="Identifiant" htmlFor="smtp-user">
                <Input
                  id="smtp-user" value={form.username} autoComplete="off"
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </Field>
              <Field
                label="Mot de passe"
                hint={status.hasPassword ? 'Un mot de passe est enregistre. Laissez vide pour le conserver.' : undefined}
                htmlFor="smtp-password"
              >
                <Input
                  id="smtp-password" type="password" value={password} autoComplete="new-password"
                  placeholder={status.hasPassword ? '••••••••••••' : ''}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </div>
            <Switch
              checked={form.secure}
              onChange={(value) => setForm({ ...form, secure: value })}
              label="TLS implicite (port 465)"
              description="Laissez desactive pour STARTTLS sur le port 587."
            />
          </>
        ) : (
          <Field
            label="Cle API"
            error={fields.apiKey}
            hint={
              status.hasApiKey
                ? 'Une cle est enregistree. Laissez vide pour la conserver.'
                : form.provider === 'resend'
                  ? 'A creer sur resend.com/api-keys'
                  : 'A creer sur app.brevo.com/settings/keys/api'
            }
            htmlFor="email-api-key"
          >
            <Input
              id="email-api-key" type="password" value={apiKey} autoComplete="new-password"
              placeholder={status.hasApiKey ? '••••••••••••' : 'Collez votre cle API'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom de l'expediteur" htmlFor="smtp-from-name">
            <Input
              id="smtp-from-name" value={form.fromName}
              onChange={(e) => setForm({ ...form, fromName: e.target.value })}
            />
          </Field>
          <Field label="Adresse d'expedition" error={fields.fromEmail} htmlFor="smtp-from-email">
            <Input
              id="smtp-from-email" type="email" value={form.fromEmail} placeholder="nova@exemple.com"
              onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
            />
          </Field>
        </div>

        <InlineNotice
          tone="info"
          title="Le mot de passe ne quitte jamais le serveur"
          icon={<ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--info)]" />}
        >
          Il est chiffre (AES-256-GCM) avant stockage. Aucun mot de passe de compte
          n'est jamais envoye par e-mail.
        </InlineNotice>

        {status.lastCheckAt ? (
          <p className="text-[12px] text-muted-fg">
            Dernier test : {formatDateTime(status.lastCheckAt)} —{' '}
            <span className={status.lastCheckStatus === 'ok' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
              {status.lastCheckMessage}
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <Button loading={saving} icon={<KeyRound className="size-4" />} onClick={save}>
            Enregistrer
          </Button>
          <div className="flex items-end gap-2">
            <Field label="Envoyer un test a" htmlFor="smtp-test">
              <Input
                id="smtp-test" type="email" value={testTo} placeholder="vous@entreprise.com"
                className="min-w-[220px]"
                onChange={(e) => setTestTo(e.target.value)}
              />
            </Field>
            <Button variant="secondary" loading={testing} icon={<Send className="size-4" />} onClick={test}>
              Tester
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
