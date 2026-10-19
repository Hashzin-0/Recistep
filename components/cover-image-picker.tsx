"use client";

import { useEffect, useState } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

export type CoverImagePickerProps = {
  value: File | null;
  onChange: (file: File | null) => void;
  onInvalid?: (message: string) => void;
  disabled?: boolean;
  idPrefix: string;
  existingUrl?: string | null;
  hint?: string;
};

export function CoverImagePicker({
  value,
  onChange,
  onInvalid,
  disabled = false,
  idPrefix,
  existingUrl = null,
  hint = "JPG, PNG ou WebP · até 8 MB. A capa é aplicada quando você salvar a receita.",
}: CoverImagePickerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const shown = previewUrl ?? existingUrl;

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      onInvalid?.("Envie uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      onInvalid?.("A imagem deve ter no máximo 8 MB.");
      return;
    }
    onChange(file);
  }

  return (
    <section className="recipe-cover-editor">
      <strong>Foto de capa</strong>
      {shown
        ? <img className="recipe-cover-image" src={shown} alt="Prévia da capa da receita" />
        : <p className="field-hint">Nenhuma capa selecionada.</p>}
      <div className="recipe-detail-actions">
        <label className="auth-secondary-button recipe-upload-label">
          {shown ? "Substituir capa" : "Adicionar capa"}
          <input
            id={`${idPrefix}-cover`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled}
            onChange={(event) => {
              handleFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {value && (
          <button className="link-button danger" type="button" disabled={disabled} onClick={() => onChange(null)}>
            Remover capa
          </button>
        )}
      </div>
      <p className="field-hint">{hint}</p>
    </section>
  );
}
