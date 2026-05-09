import Script from "next/script"
import type { Metadata } from "next"
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google"

import { ThemeProvider } from "@/components/ThemeProvider"
import { getThemeScript } from "@/lib/theme"

import "./globals.css"

const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
})

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})

export const metadata: Metadata = {
  title: "Trade Exception Review Agent",
  description: "HITL supervision cockpit for trade exception review",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${manrope.variable} ${fraunces.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {getThemeScript()}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
