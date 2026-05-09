export const THEME_STORAGE_KEY = "trade-review-theme"

export type ThemePreference = "light" | "dark" | "system"
export type ResolvedTheme = Exclude<ThemePreference, "system">

export const THEME_OPTIONS: Array<{
  value: ThemePreference
  label: string
  description: string
}> = [
  { value: "light", label: "Light", description: "Soft daylight palette" },
  { value: "dark", label: "Dark", description: "Muted twilight palette" },
  { value: "system", label: "System", description: "Follow device setting" },
]

export function isThemePreference(value: string | undefined): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system"
}

export function getResolvedTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return preference === "system" ? systemTheme : preference
}

export function getThemeScript(): string {
  return `
    (() => {
      const storageKey = "${THEME_STORAGE_KEY}";
      const root = document.documentElement;
      const storedTheme = window.localStorage.getItem(storageKey);
      const preference =
        storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
          ? storedTheme
          : "system";
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
      const resolvedTheme = preference === "system" ? systemTheme : preference;

      root.dataset.themePreference = preference;
      root.dataset.theme = resolvedTheme;
    })();
  `
}

export const RISK_BADGE_CLASSES: Record<string, string> = {
  critical: "border-[var(--critical-border)] bg-[var(--critical-soft)] text-[var(--critical-ink)]",
  high: "border-[var(--alert-border)] bg-[var(--alert-soft)] text-[var(--alert-ink)]",
  medium: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-ink)]",
  low: "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]",
}

export const STATUS_PILL_CLASSES: Record<string, string> = {
  idle: "border-[var(--border-soft)] bg-surface-muted text-ink-muted",
  starting: "border-[var(--accent-soft)] bg-[var(--accent-soft)] text-accent",
  running: "border-[var(--accent-soft)] bg-[var(--accent-soft)] text-accent",
  streaming: "border-[var(--accent-soft)] bg-[var(--accent-soft)] text-accent",
  waiting_human: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-ink)]",
  resuming: "border-[var(--accent-soft)] bg-[var(--accent-soft)] text-accent",
  complete: "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-ink)]",
  escalated: "border-[var(--alert-border)] bg-[var(--alert-soft)] text-[var(--alert-ink)]",
  error: "border-[var(--critical-border)] bg-[var(--critical-soft)] text-[var(--critical-ink)]",
}

export const STATUS_TEXT_CLASSES: Record<string, string> = {
  idle: "text-ink-muted",
  starting: "text-accent",
  running: "text-accent",
  streaming: "text-accent",
  waiting_human: "text-[var(--warning-ink)]",
  resuming: "text-accent",
  complete: "text-[var(--success-ink)]",
  escalated: "text-[var(--alert-ink)]",
  error: "text-[var(--critical-ink)]",
}

export function resolveConfidenceRiskLevel(confidence?: number | null): "low" | "medium" | "high" {
  if (confidence == null) return "medium"
  if (confidence > 0.85) return "low"
  if (confidence > 0.7) return "medium"
  return "high"
}

export function getConfidenceBarClass(confidencePercent: number): string {
  if (confidencePercent > 85) return "bg-[var(--success-solid)]"
  if (confidencePercent > 70) return "bg-[var(--warning-solid)]"
  return "bg-[var(--alert-solid)]"
}
