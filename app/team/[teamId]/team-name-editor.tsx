"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type TeamNameEditorProps = {
  teamId: string;
  initialName: string;
};

export function TeamNameEditor({ teamId, initialName }: TeamNameEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function cancel() {
    setName(initialName);
    setError(null);
    setEditing(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/teams/${teamId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json()) as { error?: string; issues?: string[]; team?: { name: string } };

      if (!response.ok || !result.team) {
        setError(result.issues?.[0] ?? result.error ?? "Team name could not be saved.");
        return;
      }

      setName(result.team.name);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Team name could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="team-name-heading">
        <h1>{name}</h1>
        <button className="team-name-edit" type="button" onClick={() => setEditing(true)} aria-label={`Rename ${name}`}>
          Rename
        </button>
      </div>
    );
  }

  return (
    <form className="team-name-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="team-name-input">Team name</label>
      <input
        id="team-name-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        minLength={3}
        maxLength={40}
        autoFocus
        required
      />
      <button className="primary-button" type="submit" disabled={saving || name.trim().length < 3} aria-busy={saving}>
        Save
      </button>
      <button className="secondary-button" type="button" onClick={cancel} disabled={saving}>Cancel</button>
      {error ? <span className="team-name-error" role="alert">{error}</span> : null}
    </form>
  );
}
