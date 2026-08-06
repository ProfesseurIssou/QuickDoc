// A VSCode-style key-capture widget: click, press a key combo, done.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeBinding, fromEvent } from "../lib/keycapture";

interface Props {
  value: string;
  onChange: (binding: string) => void;
}

export default function KeyCapture({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [capturing, setCapturing] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      const binding = describeBinding(fromEvent(e));
      if (binding) {
        onChange(binding);
        setCapturing(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onChange]);

  return (
    <button
      ref={ref}
      type="button"
      className={capturing ? "capture capturing" : "capture"}
      onClick={() => setCapturing((c) => !c)}
    >
      {capturing ? t("settings.pressKeys") : value}
    </button>
  );
}
