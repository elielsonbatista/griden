export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  return /mac/i.test(platform);
}

export function modKey(): string {
  return isMac() ? "⌘" : "Ctrl";
}

export function shortcutLabel(...rest: string[]): string {
  return [modKey(), ...rest].join("+");
}
