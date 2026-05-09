import Link from "next/link"

import { ThemeSwitcher } from "@/components/ThemeSwitcher"

const HIGHLIGHTS = [
  {
    title: "Confidence-gated review",
    description: "Operators step in only when the agent falls below policy thresholds or needs a steering decision.",
  },
  {
    title: "Checkpointed execution",
    description: "Each interrupted thread can pause, resume, or escalate without losing its investigation history.",
  },
  {
    title: "Streaming supervision",
    description: "Reasoning, queue state, and resolution proposals all stay visible while the agent works live.",
  },
]

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 lg:px-6 lg:py-6">
      <section className="panel-elevated relative overflow-hidden rounded-[2rem] px-6 py-6 sm:px-8 sm:py-8">
        <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.4),transparent_72%)]" />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-line-strong bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-ink-soft">
                Human-in-the-loop ops
              </span>
              <span className="rounded-full border border-accent/25 bg-accent-soft px-3 py-1 text-[11px] font-medium text-accent">
                Modern muted theme system
              </span>
            </div>

            <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[0.95] tracking-[-0.04em] text-ink-strong sm:text-6xl">
              A softer supervision cockpit for high-stakes exception handling.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted sm:text-lg">
              The frontend now uses a shared light and dark palette, persistent theme selection,
              and a calmer operator surface designed for long review sessions.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-contrast shadow-[0_24px_44px_-28px_var(--accent)] hover:-translate-y-0.5 hover:bg-accent-strong"
              >
                Open dashboard
              </Link>
              <div className="inline-flex items-center justify-center rounded-full border border-line-strong bg-surface px-4 py-3 text-sm text-ink-muted">
                Theme preference is remembered after your first switch.
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-4 lg:items-end">
            <ThemeSwitcher />
            <div className="panel w-full max-w-sm rounded-[1.6rem] p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-ink-soft">What changed</p>
              <div className="mt-4 space-y-3">
                <div className="rounded-[1.1rem] border border-line-strong bg-surface-muted px-4 py-3">
                  <p className="text-sm font-semibold text-ink-strong">Light mode</p>
                  <p className="mt-1 text-sm leading-6 text-ink-muted">
                    Warm stone neutrals, lavender accents, and pastel risk tones.
                  </p>
                </div>
                <div className="rounded-[1.1rem] border border-line-strong bg-surface-muted px-4 py-3">
                  <p className="text-sm font-semibold text-ink-strong">Dark mode</p>
                  <p className="mt-1 text-sm leading-6 text-ink-muted">
                    A related twilight palette with softer contrast and clearer state surfaces.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        {HIGHLIGHTS.map((item) => (
          <article key={item.title} className="panel rounded-[1.6rem] p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-ink-soft">Capability</p>
            <h2 className="mt-4 text-xl font-semibold text-ink-strong">{item.title}</h2>
            <p className="mt-3 text-sm leading-6 text-ink-muted">{item.description}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
