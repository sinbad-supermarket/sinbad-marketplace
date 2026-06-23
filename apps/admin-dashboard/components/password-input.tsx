"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
};

export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  required = true
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="relative mt-1">
        <input
          className="h-11 w-full rounded-md border border-line px-3 pr-11 text-sm outline-none focus:border-ink"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required={required}
        />
        <button
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-slate-500 hover:text-ink focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ink"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </label>
  );
}
