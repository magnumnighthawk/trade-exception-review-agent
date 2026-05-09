"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  THEME_STORAGE_KEY,
  getResolvedTheme,
  isThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme"

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)"

type ThemeContextValue = {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light"
}

function readInitialThemeState(): { theme: ThemePreference; resolvedTheme: ResolvedTheme } {
  if (typeof document === "undefined") {
    return { theme: "system", resolvedTheme: "light" }
  }

  const root = document.documentElement
  return {
    theme: isThemePreference(root.dataset.themePreference) ? root.dataset.themePreference : "system",
    resolvedTheme: root.dataset.theme === "dark" ? "dark" : "light",
  }
}

function applyTheme(theme: ThemePreference): ResolvedTheme {
  const resolvedTheme = getResolvedTheme(theme, getSystemTheme())
  const root = document.documentElement
  root.dataset.themePreference = theme
  root.dataset.theme = resolvedTheme
  return resolvedTheme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeState, setThemeState] = useState(readInitialThemeState)

  useEffect(() => {
    if (themeState.theme !== "system") return

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY)

    // LEARNING: We only react to OS theme changes while the operator is using
    // the "system" preference so manual selections stay explicit and stable.
    const handleSystemThemeChange = () => {
      setThemeState((current) => {
        if (current.theme !== "system") return current

        const resolvedTheme = applyTheme("system")
        return { theme: "system", resolvedTheme }
      })
    }

    mediaQuery.addEventListener("change", handleSystemThemeChange)
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange)
  }, [themeState.theme])

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)

    setThemeState({
      theme: nextTheme,
      resolvedTheme: applyTheme(nextTheme),
    })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themeState.theme,
      resolvedTheme: themeState.resolvedTheme,
      setTheme,
    }),
    [setTheme, themeState.resolvedTheme, themeState.theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
