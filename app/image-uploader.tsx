"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/images/limits";
import { IdentityImage } from "./identity-image";

export function ImageUploader({ endpoint, initialUrl, name, label, enabled, compact = false }: {
  endpoint: string; initialUrl?: string | null; name: string; label: string; enabled: boolean; compact?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  async function save(remove = false) {
    if (busy || (!remove && !file)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, remove ? { method: "DELETE" } : {
        method: "PUT", headers: { "Content-Type": file!.type }, body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The image could not be saved.");
      setUrl(result.url); setFile(null); setPreview(null);
      if (input.current) input.current.value = "";
      setMessage(remove ? `${label} removed.` : `${label} saved.`);
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "The image could not be saved."); }
    finally { setBusy(false); }
  }

  const controls = <div className="image-upload-controls">
        <p className="subtle">JPG, PNG, or WebP up to 4 MB. Automatically resized to fit 256 × 256 and compressed to 100 KB or less. No animation.</p>
        <p className="subtle">Uploaded images are public to anyone with their link.</p>
        {!enabled ? <p role="status">Image uploads are not configured yet.</p> : <>
          <label htmlFor={inputId}>Choose {label.toLowerCase()}</label>
          <input id={inputId} ref={input} type="file" accept={IMAGE_TYPES.join(",")} disabled={busy} onChange={(event) => {
            const selected = event.target.files?.[0];
            setFile(null); setPreview(null); setMessage(""); setError("");
            if (!selected) return;
            if (!IMAGE_TYPES.includes(selected.type) || selected.size > MAX_UPLOAD_BYTES || !selected.size) {
              setError("Choose a JPG, PNG, or WebP image up to 4 MB."); event.target.value = ""; return;
            }
            setFile(selected); setPreview(URL.createObjectURL(selected));
          }} />
          <div className="image-upload-actions">
            <button className="primary-button" type="button" disabled={busy || !file} onClick={() => void save()}>{busy ? "Saving…" : "Upload image"}</button>
            <button className="secondary-button" type="button" disabled={busy || !url} onClick={() => void save(true)}>Remove image</button>
          </div>
        </>}
        {error ? <p role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
      </div>;

  if (compact) return <div className="team-logo-editor">
    <button className="team-logo-button" type="button" aria-label={`Edit ${label.toLowerCase()}`} title={`Edit ${label.toLowerCase()}`}
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <IdentityImage url={url} name={name} size="large" />
    </button>
    <dialog className="image-upload-dialog" ref={dialog} aria-labelledby={`${inputId}-heading`}
      onCancel={(event) => { if (busy) event.preventDefault(); }}
      onClose={() => {
        setFile(null); setPreview(null); setError(""); setMessage("");
        if (input.current) input.current.value = "";
      }}>
      <div className="image-dialog-heading">
        <h2 id={`${inputId}-heading`}>Edit {label.toLowerCase()}</h2>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => dialog.current?.close()} aria-label="Close image editor">Close</button>
      </div>
      <IdentityImage url={file ? preview : url} name={name} size="large" />
      {controls}
    </dialog>
  </div>;

  return <div className="image-uploader">
    <IdentityImage url={file ? preview : url} name={name} size="large" />
    <details>
      <summary>Edit {label.toLowerCase()}</summary>
      {controls}
    </details>
  </div>;
}
