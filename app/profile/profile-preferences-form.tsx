"use client";

import { type FormEvent, useEffect, useState } from "react";
import { oauthScopes, scopeDescriptions } from "@/lib/auth/scopes";
import type { ApiTokenSummary, CreatedApiToken } from "@/lib/data/api-tokens";
import type { OAuthScope } from "@/lib/auth/scopes";
import type { DisplayMode, UserProfilePreferences } from "@/lib/data/profile";

type ProfilePreferencesFormProps = {
  initialProfile: UserProfilePreferences;
  initialApiTokens: ApiTokenSummary[];
};

type SubmitState =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const notificationOptions = [
  {
    key: "injuries",
    label: "Player injuries",
    description: "Injury, IL, and day-to-day status changes for rostered players.",
  },
  {
    key: "trades",
    label: "Trade offers",
    description: "Incoming offers, accepted trades, veto windows, and commissioner rulings.",
  },
  {
    key: "waivers",
    label: "Waivers",
    description: "Claims processed, failed claims, dropped players, and FAAB balance changes.",
  },
  {
    key: "lineupAlerts",
    label: "Lineup alerts",
    description: "Empty active slots, postponed games, probable starters, and locked players.",
  },
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function ProfilePreferencesForm({ initialProfile, initialApiTokens }: ProfilePreferencesFormProps) {
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [timeZone, setTimeZone] = useState(initialProfile.timeZone);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(initialProfile.displayMode);
  const [notifications, setNotifications] = useState(initialProfile.notifications);
  const [apiTokens, setApiTokens] = useState(initialApiTokens);
  const [tokenName, setTokenName] = useState("Owner automation");
  const [tokenScopes, setTokenScopes] = useState<OAuthScope[]>(["read:profile", "read:league", "read:team", "write:lineup"]);
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [createdToken, setCreatedToken] = useState<CreatedApiToken | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle", message: "" });
  const [tokenState, setTokenState] = useState<SubmitState>({ kind: "idle", message: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = displayMode;
  }, [displayMode]);

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSubmitState({ kind: "idle", message: "Saving preferences..." });

    try {
      const response = await fetch("/api/v1/profile/preferences", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName,
          timeZone,
          displayMode,
          notifications,
        }),
      });
      const result = (await response.json()) as { error?: string; issues?: string[]; profile?: UserProfilePreferences };

      if (!response.ok || !result.profile) {
        setSubmitState({
          kind: "error",
          message: result.issues?.[0] ?? result.error ?? "Preferences could not be saved.",
        });
        return;
      }

      setDisplayName(result.profile.displayName);
      setTimeZone(result.profile.timeZone);
      setDisplayMode(result.profile.displayMode);
      setNotifications(result.profile.notifications);
      setSubmitState({ kind: "success", message: "Preferences saved." });
    } catch {
      setSubmitState({ kind: "error", message: "Preferences could not be saved." });
    } finally {
      setIsSaving(false);
    }
  }

  function toggleScope(scope: OAuthScope, enabled: boolean) {
    setTokenScopes((current) => {
      if (enabled) {
        return current.includes(scope) ? current : [...current, scope];
      }

      return current.filter((candidate) => candidate !== scope);
    });
  }

  async function createToken() {
    setIsCreatingToken(true);
    setTokenState({ kind: "idle", message: "Creating token..." });
    setCreatedToken(null);

    try {
      const response = await fetch("/api/v1/profile/tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: tokenName,
          scopes: tokenScopes,
          expiresInDays,
        }),
      });
      const result = (await response.json()) as CreatedApiToken & { error?: string; issues?: string[] };

      if (!response.ok || !result.token) {
        setTokenState({
          kind: "error",
          message: result.issues?.[0] ?? result.error ?? "API token could not be created.",
        });
        return;
      }

      setApiTokens((current) => [result.summary, ...current]);
      setCreatedToken(result);
      setTokenState({ kind: "success", message: "API token created. Copy it now; it will not be shown again." });
    } catch {
      setTokenState({ kind: "error", message: "API token could not be created." });
    } finally {
      setIsCreatingToken(false);
    }
  }

  async function revokeToken(tokenId: string) {
    setRevokingTokenId(tokenId);
    setTokenState({ kind: "idle", message: "Revoking token..." });

    try {
      const response = await fetch(`/api/v1/profile/tokens/${tokenId}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setTokenState({ kind: "error", message: result.error ?? "API token could not be revoked." });
        return;
      }

      setApiTokens((current) => current.filter((token) => token.id !== tokenId));
      setTokenState({ kind: "success", message: "API token revoked." });
    } catch {
      setTokenState({ kind: "error", message: "API token could not be revoked." });
    } finally {
      setRevokingTokenId(null);
    }
  }

  return (
    <form className="profile-form" onSubmit={savePreferences}>
      {submitState.message ? (
        <div className={submitState.kind === "error" ? "status-banner bad" : "status-banner good"}>{submitState.message}</div>
      ) : null}

      <div className="content-grid">
        <section className="panel form-panel" aria-labelledby="profile-heading">
          <h1 id="profile-heading">Profile</h1>
          <label className="field">
            <span>Display Name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input value={initialProfile.email} disabled />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Time Zone</span>
              <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                <option value="America/Los_Angeles">Pacific Time</option>
                <option value="America/Denver">Mountain Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            <label className="field">
              <span>Display Mode</span>
              <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)}>
                <option value="auto">Auto</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
        </section>

        <aside className="panel api-panel" aria-labelledby="api-heading">
          <h2 id="api-heading">API Access</h2>
          <a className="secondary-button" href="/api-docs">
            Open API Docs
          </a>
          {tokenState.message ? (
            <div className={tokenState.kind === "error" ? "status-banner bad" : "status-banner good"}>{tokenState.message}</div>
          ) : null}
          {createdToken ? (
            <div className="token-secret" aria-label="New API token">
              <span>{createdToken.token}</span>
            </div>
          ) : null}
          <div className="token-controls">
            <label className="field">
              <span>Token Name</span>
              <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
            </label>
            <label className="field">
              <span>Expires</span>
              <select value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">1 year</option>
              </select>
            </label>
          </div>
          <div className="scope-list" aria-label="Token scopes">
            {oauthScopes.map((scope) => (
              <label className="scope-row" key={scope}>
                <input
                  type="checkbox"
                  checked={tokenScopes.includes(scope)}
                  onChange={(event) => toggleScope(scope, event.target.checked)}
                />
                <span>
                  <span className="player-name">{scope}</span>
                  <span className="player-meta">{scopeDescriptions[scope]}</span>
                </span>
              </label>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={createToken} disabled={isCreatingToken}>
            {isCreatingToken ? "Creating..." : "Create Token"}
          </button>

          <div className="setting-list token-list">
            {apiTokens.length ? (
              apiTokens.map((token) => (
                <div className="token-row" key={token.id}>
                  <div>
                    <div className="player-name">{token.name}</div>
                    <div className="player-meta">
                      {token.scopes.length} scopes, expires {formatDate(token.expiresAt)}
                    </div>
                  </div>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => revokeToken(token.id)}
                    disabled={revokingTokenId === token.id}
                  >
                    {revokingTokenId === token.id ? "Revoking" : "Revoke"}
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state">No active API tokens</div>
            )}
          </div>
        </aside>
      </div>

      <section className="panel preference-panel" aria-labelledby="notifications-heading">
        <h2 id="notifications-heading">Notifications</h2>
        <div className="preference-list">
          {notificationOptions.map((preference) => (
            <label className="preference-row" key={preference.key}>
              <span>
                <span className="player-name">{preference.label}</span>
                <span className="player-meta">{preference.description}</span>
              </span>
              <input
                type="checkbox"
                checked={notifications[preference.key]}
                onChange={(event) =>
                  setNotifications((current) => ({
                    ...current,
                    [preference.key]: event.target.checked,
                  }))
                }
              />
            </label>
          ))}
        </div>
      </section>

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Preferences"}
        </button>
      </div>
    </form>
  );
}
