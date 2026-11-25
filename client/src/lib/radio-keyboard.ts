import type { KeyboardEvent } from "react";

/** Arrow keys select and focus the next enabled radio, wrapping at both ends. */
export function handleRadioArrowKey(event: KeyboardEvent<HTMLDivElement>) {
  const directions: Record<string, number | undefined> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const direction = directions[event.key];
  if (!direction) return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
  const index = radios.findIndex((radio) => radio === event.target);
  if (index < 0) return;
  event.preventDefault();
  const next = radios[(index + direction + radios.length) % radios.length];
  next.focus();
  next.click();
}
