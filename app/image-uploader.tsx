"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cropImageToBlob, type ImageCrop } from "@/lib/images/crop-client";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/images/limits";
import { IdentityImage } from "./identity-image";

const DEFAULT_CROP: ImageCrop = { x: 0.5, y: 0.5, zoom: 1 };

export function ImageUploader({ endpoint, initialUrl, name, label, enabled, compact = false }: {
  endpoint: string; initialUrl?: string | null; name: string; label: string; enabled: boolean; compact?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cropImage = useRef<HTMLImageElement>(null);
  const cropViewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState<ImageCrop>(DEFAULT_CROP);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
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
      const body = remove ? null : await cropImageToBlob(cropImage.current!, crop);
      const response = await fetch(endpoint, remove ? { method: "DELETE" } : {
        method: "PUT", headers: { "Content-Type": body!.type }, body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The image could not be saved.");
      setUrl(result.url); setFile(null); setPreview(null); setImageSize({ width: 0, height: 0 });
      if (input.current) input.current.value = "";
      setMessage(remove ? `${label} removed.` : `${label} saved.`);
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "The image could not be saved."); }
    finally { setBusy(false); }
  }

  const wide = imageSize.width >= imageSize.height;
  const ratio = imageSize.width && imageSize.height ? imageSize.width / imageSize.height : 1;
  const displayWidth = (wide ? ratio : 1) * crop.zoom;
  const displayHeight = (wide ? 1 : 1 / ratio) * crop.zoom;
  function moveCrop(clientX: number, clientY: number) {
    if (!drag.current || !cropViewport.current) return;
    const dx = clientX - drag.current.x;
    const dy = clientY - drag.current.y;
    drag.current = { x: clientX, y: clientY };
    const { clientWidth, clientHeight } = cropViewport.current;
    setCrop((current) => ({
      ...current,
      x: displayWidth > 1 ? Math.max(0, Math.min(1, current.x - dx / (clientWidth * (displayWidth - 1)))) : 0.5,
      y: displayHeight > 1 ? Math.max(0, Math.min(1, current.y - dy / (clientHeight * (displayHeight - 1)))) : 0.5,
    }));
  }

  const controls = <div className="image-upload-controls">
        <p className="subtle">JPG, PNG, or WebP up to 4 MB. Crop to a square, then the image is resized to 256 × 256 and compressed to 100 KB or less. No animation.</p>
        <p className="subtle">Uploaded images are public to anyone with their link.</p>
        {!enabled ? <p role="status">Image uploads are not configured yet.</p> : <>
          <label htmlFor={inputId}>Choose {label.toLowerCase()}</label>
          <input id={inputId} ref={input} type="file" accept={IMAGE_TYPES.join(",")} disabled={busy} onChange={(event) => {
            const selected = event.target.files?.[0];
            setFile(null); setPreview(null); setImageSize({ width: 0, height: 0 }); setMessage(""); setError("");
            if (!selected) return;
            if (!IMAGE_TYPES.includes(selected.type) || selected.size > MAX_UPLOAD_BYTES || !selected.size) {
              setError("Choose a JPG, PNG, or WebP image up to 4 MB."); event.target.value = ""; return;
            }
            setCrop(DEFAULT_CROP); setFile(selected); setPreview(URL.createObjectURL(selected));
          }} />
          {file && preview ? <div className="image-crop-editor">
            <p className="subtle">Drag the image or use the controls to choose the square crop.</p>
            <div className="image-crop-viewport" ref={cropViewport}
              onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => moveCrop(event.clientX, event.clientY)}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
              {/* The blob URL is local and is revoked when selection changes. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={cropImage} src={preview} alt={`${label} crop preview`} draggable={false}
                onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                onError={() => setError("This image could not be read.")}
                style={{ width: `${displayWidth * 100}%`, height: `${displayHeight * 100}%`, left: `${-crop.x * (displayWidth - 1) * 100}%`, top: `${-crop.y * (displayHeight - 1) * 100}%` }} />
            </div>
            <div className="image-crop-controls">
              <label>Zoom <input aria-label="Zoom" type="range" min="1" max="3" step="0.01" value={crop.zoom}
                onChange={(event) => setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))} /></label>
              <label>Horizontal position <input aria-label="Horizontal position" type="range" min="0" max="1" step="0.01" value={crop.x}
                disabled={displayWidth <= 1} onChange={(event) => setCrop((current) => ({ ...current, x: Number(event.target.value) }))} /></label>
              <label>Vertical position <input aria-label="Vertical position" type="range" min="0" max="1" step="0.01" value={crop.y}
                disabled={displayHeight <= 1} onChange={(event) => setCrop((current) => ({ ...current, y: Number(event.target.value) }))} /></label>
            </div>
          </div> : null}
          <div className="image-upload-actions">
            <button className="primary-button" type="button" disabled={busy || !file || !imageSize.width} onClick={() => void save()}>{busy ? "Saving…" : "Upload image"}</button>
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
      <IdentityImage url={url} name={name} size="large" />
      {controls}
    </dialog>
  </div>;

  return <div className="image-uploader">
    <IdentityImage url={url} name={name} size="large" />
    <details>
      <summary>Edit {label.toLowerCase()}</summary>
      {controls}
    </details>
  </div>;
}
