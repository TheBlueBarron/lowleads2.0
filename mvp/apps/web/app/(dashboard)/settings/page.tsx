'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { TierBadge } from '@/components/ui/Badge';
import type { Company } from '@lowleads/shared-types';

interface NotificationPrefs {
  userId: string;
  emailNewLead: boolean;
  emailLeadResolved: boolean;
  emailLowEscrow: boolean;
  lowEscrowThresholdCents: number;
  updatedAt: string;
}

export default function SettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingNotifs, setSavingNotifs] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [notifError, setNotifError] = useState('');
  const [notifSuccess, setNotifSuccess] = useState(false);

  const [name, setName] = useState('');
  const [serviceAreaInput, setServiceAreaInput] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [co, p] = await Promise.all([
          apiFetch<Company>('/v1/companies/me'),
          apiFetch<NotificationPrefs>('/v1/notifications/preferences'),
        ]);
        setCompany(co);
        setName(co.name);
        setServiceAreaInput(co.serviceArea.join(', '));
        setPrefs(p);
      } catch {
        /* silently fail — individual sections will be empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess(false);
    setSavingProfile(true);
    try {
      const serviceArea = serviceAreaInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await apiFetch<Company>('/v1/companies/me', {
        method: 'PATCH',
        body: { name, serviceArea },
      });
      setCompany(updated);
      setProfileSuccess(true);
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Failed to save profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleNotifToggle(field: keyof Pick<NotificationPrefs, 'emailNewLead' | 'emailLeadResolved' | 'emailLowEscrow'>) {
    if (!prefs) return;
    const next = { ...prefs, [field]: !prefs[field] };
    setPrefs(next);
    try {
      const updated = await apiFetch<NotificationPrefs>('/v1/notifications/preferences', {
        method: 'PATCH',
        body: { [field]: !prefs[field] },
      });
      setPrefs(updated);
    } catch {
      setPrefs(prefs); // revert on error
    }
  }

  async function handleSaveNotifs(e: FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    setNotifError('');
    setNotifSuccess(false);
    setSavingNotifs(true);
    try {
      const updated = await apiFetch<NotificationPrefs>('/v1/notifications/preferences', {
        method: 'PATCH',
        body: {
          emailNewLead: prefs.emailNewLead,
          emailLeadResolved: prefs.emailLeadResolved,
          emailLowEscrow: prefs.emailLowEscrow,
          lowEscrowThresholdCents: prefs.lowEscrowThresholdCents,
        },
      });
      setPrefs(updated);
      setNotifSuccess(true);
    } catch (err) {
      setNotifError(err instanceof ApiError ? err.message : 'Failed to save notifications.');
    } finally {
      setSavingNotifs(false);
    }
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Company Profile */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Company Profile</h2>
          {company && <TierBadge tier={company.subscriptionTier} />}
        </div>

        {profileSuccess && (
          <Alert variant="success" className="mb-4">Profile saved successfully.</Alert>
        )}
        {profileError && <Alert className="mb-4">{profileError}</Alert>}

        <form onSubmit={(e) => void handleProfileSave(e)} className="space-y-4">
          <Input
            label="Company name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Service areas"
            value={serviceAreaInput}
            onChange={(e) => setServiceAreaInput(e.target.value)}
            hint="Comma-separated list: Phoenix, Scottsdale, Tempe"
            placeholder="Phoenix, Scottsdale, Tempe"
          />
          {company && (
            <div className="text-xs text-gray-500 space-y-1 pt-1 border-t border-gray-100">
              <p><span className="font-medium">Slug:</span> {company.slug}</p>
              <p><span className="font-medium">Transaction fee:</span> {company.transactionFeeBps / 100}%</p>
              {company.verifiedAt && <p className="text-green-600">✓ Company verified</p>}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" loading={savingProfile} size="sm">Save Profile</Button>
          </div>
        </form>
      </Card>

      {/* Notification Preferences */}
      {prefs && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Email Notifications</h2>

          {notifSuccess && (
            <Alert variant="success" className="mb-4">Preferences saved.</Alert>
          )}
          {notifError && <Alert className="mb-4">{notifError}</Alert>}

          <form onSubmit={(e) => void handleSaveNotifs(e)} className="space-y-4">
            <Toggle
              label="New lead received"
              description="Get an email when a lead is submitted to your listing."
              checked={prefs.emailNewLead}
              onChange={() => void handleNotifToggle('emailNewLead')}
            />
            <Toggle
              label="Lead resolved"
              description="Get an email when a lead outcome is recorded."
              checked={prefs.emailLeadResolved}
              onChange={() => void handleNotifToggle('emailLeadResolved')}
            />
            <Toggle
              label="Low escrow balance"
              description="Get an email when your escrow balance falls below the threshold."
              checked={prefs.emailLowEscrow}
              onChange={() => void handleNotifToggle('emailLowEscrow')}
            />
            {prefs.emailLowEscrow && (
              <Input
                label="Low balance threshold ($)"
                type="number"
                step="1"
                min="0"
                value={(prefs.lowEscrowThresholdCents / 100).toFixed(0)}
                onChange={(e) =>
                  setPrefs((p) =>
                    p ? { ...p, lowEscrowThresholdCents: parseInt(e.target.value, 10) * 100 } : p,
                  )
                }
              />
            )}
            <div className="flex justify-end">
              <Button type="submit" loading={savingNotifs} size="sm">Save Notifications</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={onChange}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            checked ? 'bg-indigo-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </label>
  );
}
