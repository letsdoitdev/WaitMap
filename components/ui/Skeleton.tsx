"use client";

import type { CSSProperties } from "react";

export type SkeletonProps = {
  w?: number | string;
  h: number;
  radius?: number;
  variant?: "rect" | "circle" | "pill";
  /** Inline style escape hatch — handy for aspect-ratio overrides. */
  style?: CSSProperties;
  className?: string;
  "aria-hidden"?: boolean;
};

export default function Skeleton({
  w = "100%",
  h,
  radius = 12,
  variant = "rect",
  style,
  className,
  "aria-hidden": ariaHidden = true,
}: SkeletonProps) {
  const computedRadius =
    variant === "circle"
      ? "50%"
      : variant === "pill"
        ? "999px"
        : `${radius}px`;
  return (
    <span
      role="presentation"
      aria-hidden={ariaHidden}
      className={`ds-skeleton ${className ?? ""}`.trim()}
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: `${h}px`,
        borderRadius: computedRadius,
        ...style,
      }}
    />
  );
}
