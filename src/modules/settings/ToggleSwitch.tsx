import { type KeyboardEvent } from "react";

interface ToggleSwitchProps {
  ariaLabel?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleSwitch({
  ariaLabel,
  checked,
  disabled = false,
  onChange,
}: ToggleSwitchProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onChange(!checked);
    }
  }

  return (
    <div
      aria-checked={checked}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      className={`toggle-switch ${checked ? "toggle-switch-on" : ""}${disabled ? " toggle-switch-disabled" : ""}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      onKeyDown={handleKeyDown}
      role="switch"
      tabIndex={disabled ? -1 : 0}
    >
      <span className="toggle-switch-track">
        <span className="toggle-switch-knob" />
      </span>
    </div>
  );
}
