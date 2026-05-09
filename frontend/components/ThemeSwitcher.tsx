"use client"

import { THEME_OPTIONS } from "@/lib/theme"

import { useTheme } from "@/components/ThemeProvider"

function ThemeIcon({
  option,
  active,
}: {
  option: "light" | "dark" | "system"
  active: boolean
}) {
  const commonProps = {
    className: active ? "opacity-100" : "opacity-75",
    "aria-hidden": true,
  }

  if (option === "light") {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" className={`${commonProps.className} h-3.5 w-3.5`}>
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path
          d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.72 5.28l-1.77 1.77M7.05 16.95l-1.77 1.77M18.72 18.72l-1.77-1.77M7.05 7.05L5.28 5.28"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    )
  }

  if (option === "dark") {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" className={`${commonProps.className} h-3.5 w-3.5`}>
        <path
          d="M17.5 14.6A7.1 7.1 0 0 1 9.4 6.5a7.9 7.9 0 1 0 8.1 8.1Z"
          fill="currentColor"
        />
      </svg>
    )
  }

  return (
    <svg {...commonProps} viewBox="0 0 24 24" className={`${commonProps.className} h-3.5 w-3.5`}>
      <rect x="4" y="5" width="16" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 19h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 16v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  )
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <div
      className={`panel-elevated inline-flex items-center gap-1 rounded-full ${
        compact ? "p-1" : "p-1.5"
      }`}
    >
      {THEME_OPTIONS.map((option) => {
        const isActive = theme === option.value
        const description =
          option.value === "system"
            ? `${option.description} · currently ${resolvedTheme}`
            : option.description

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={`group flex items-center rounded-full text-xs font-medium ${
              isActive
                ? "bg-accent text-accent-contrast shadow-[0_12px_30px_-18px_var(--accent)]"
                : "text-ink-muted hover:bg-surface-hover hover:text-ink-strong"
            } ${compact ? "h-9 w-9 justify-center px-0 py-0" : "gap-2 px-3 py-2"}`}
            aria-label={`Switch to ${option.label} theme`}
            aria-pressed={isActive}
            title={description}
          >
            <ThemeIcon option={option.value} active={isActive} />
            {!compact && <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
