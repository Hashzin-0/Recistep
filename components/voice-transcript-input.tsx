"use client";

import { useEffect, useRef, useState } from "react";

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative };
type SpeechResultList = { length: number; [index: number]: SpeechResult };
type SpeechResultEvent = { resultIndex: number; results: SpeechResultList };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function VoiceTranscriptInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const latestValueRef = useRef(value);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [message, setMessage] = useState("");
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  function startDictation() {
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      setMessage("Este navegador não oferece ditado por voz. Você ainda pode digitar ou colar a transcrição.");
      return;
    }

    try {
      recognitionRef.current?.abort();
      const recognition = new SpeechRecognition();
      recognition.lang = "pt-BR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const phrase = result[0]?.transcript?.trim() ?? "";
          if (!phrase) continue;
          if (result.isFinal) finalText += (finalText ? " " : "") + phrase;
          else interimText += (interimText ? " " : "") + phrase;
        }
        if (finalText) {
          const existing = latestValueRef.current.trim();
          const next = [existing, finalText].filter(Boolean).join(" ");
          latestValueRef.current = next;
          onChange(next);
        }
        setInterim(interimText);
      };
      recognition.onerror = (event) => {
        setListening(false);
        setInterim("");
        setMessage(event.error === "not-allowed"
          ? "Permissão de microfone negada. Autorize o microfone nas configurações do navegador."
          : event.error === "no-speech"
            ? "Nenhuma fala foi detectada. Tente novamente ou digite a receita."
            : "O ditado foi interrompido pelo navegador. Confira o texto capturado e tente novamente.");
      };
      recognition.onend = () => {
        setListening(false);
        setInterim("");
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      setMessage("Ditado ativo. Fale em português; revise o texto antes de gerar a receita.");
      setListening(true);
      recognition.start();
    } catch {
      setListening(false);
      setMessage("Não foi possível iniciar o microfone. Verifique a permissão do navegador.");
    }
  }

  function stopDictation() {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
    setMessage("Ditado pausado. Você pode revisar e editar a transcrição.");
  }

  return (
    <div className="voice-transcript-input">
      <div className="voice-transcript-controls">
        <button
          className={listening ? "auth-secondary-button" : "import-button"}
          type="button"
          onClick={listening ? stopDictation : startDictation}
          disabled={disabled}
          aria-pressed={listening}
        >
          {listening ? "Parar ditado" : "Transcrever por voz"}
        </button>
        <span className="field-hint">
          {supported === false ? "Ditado indisponível neste navegador" : "Microfone do dispositivo · Português (Brasil)"}
        </span>
      </div>
      <label htmlFor="voice-recipe-transcript">Fale ou escreva a receita</label>
      <textarea
        id="voice-recipe-transcript"
        value={value}
        onChange={(event) => {
          latestValueRef.current = event.target.value;
          onChange(event.target.value);
        }}
        minLength={80}
        maxLength={80000}
        rows={6}
        placeholder="Ex.: Para fazer um bolo, use duas xícaras de farinha... Diga ingredientes, quantidades e cada etapa do preparo."
        required
        disabled={disabled}
        aria-describedby="voice-transcript-help"
      />
      <p className="field-hint" id="voice-transcript-help">
        {interim ? "Capturando: " + interim : message || "A transcrição é feita pelo recurso de fala do navegador; o Recistep recebe somente o texto para montar o rascunho."}
      </p>
    </div>
  );
}
