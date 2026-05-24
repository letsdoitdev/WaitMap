"use client";

type Option<T extends string> = {
  label: string;
  value: T;
};

type Props<T extends string> = {
  options: Option<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  /** When false, picks behave like a radio group (single selection). */
  multi?: boolean;
  ariaLabel?: string;
};

/**
 * Reusable pill grid for the onboarding steps. Single-column on mobile so
 * the 56 px+ tap targets stack with breathing room, two-column from sm: per
 * the design rules. Multi-select toggles; single-select replaces.
 */
export default function BigPillChoice<T extends string>({
  options,
  selected,
  onChange,
  multi = true,
  ariaLabel,
}: Props<T>) {
  const toggle = (value: T) => {
    if (!multi) {
      onChange([value]);
      return;
    }
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div
      className="ds-onboarding-pillgrid"
      role={multi ? "group" : "radiogroup"}
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role={multi ? undefined : "radio"}
            aria-pressed={multi ? isSelected : undefined}
            aria-checked={multi ? undefined : isSelected}
            onClick={() => toggle(option.value)}
            className="ds-onboarding-pill"
            data-selected={isSelected ? "true" : "false"}
          >
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
