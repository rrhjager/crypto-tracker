// src/components/SocialCarousel.tsx
import React, { useEffect, useRef, useState } from 'react'

type Item = {
  id: string
  url: string
  author: string
  handle: string
  avatar: string
  followers: number
  createdAt: string
  contentHtml: string
  favourites: number
  reblogs: number
  image?: string | null
}

export default function SocialCarousel({
  api,
  title = 'Social buzz',
}: {
  api: string
  title?: string
}) {
  const [items, setItems] = useState<Item[]>([])
  const [err, setErr] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setErr(null)
        const r = await fetch(api, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (!aborted) setItems(j.items || [])
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      }
    })()
    return () => {
      aborted = true
    }
  }, [api])

  const scroll = (dir: 'l' | 'r') => {
    const el = wrapRef.current
    if (!el) return
    const delta = Math.round(el.clientWidth * 0.85)
    el.scrollBy({ left: dir === 'l' ? -delta : delta, behavior: 'smooth' })
  }

  if (err) {
    return (
      <section className="max-w-6xl mx-auto px-4 pb-10">
        <div className="table-card p-5">
          <div className="font-semibold mb-2">{title}</div>
          <div className="text-sm text-white/60">Failed to load: {err}</div>
        </div>
      </section>
    )
  }

  return (
    <section className="max-w-6xl mx-auto px-4 pb-16">
      <div className="table-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">{title}</div>
          <div className="flex gap-1">
            <button
              aria-label="Scroll left"
              onClick={() => scroll('l')}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/15 text-white/80 hover:text-white"
            >
              ←
            </button>
            <button
              aria-label="Scroll right"
              onClick={() => scroll('r')}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/15 text-white/80 hover:text-white"
            >
              →
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-white/60 text-sm">
            No posts found (try different tags or a lower follower threshold).
          </div>
        ) : (
          <div
            ref={wrapRef}
            className="overflow-x-auto scrollbar-hide"
            style={{ scrollSnapType: 'x mandatory' as any }}
          >
            <div className="flex gap-3 min-w-full">
              {items.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0 w-[280px] sm:w-[320px] rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition p-3"
                  style={{ scrollSnapAlign: 'start' as any }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <img
                      src={p.avatar}
                      alt={p.author}
                      className="w-8 h-8 rounded-full object-cover"
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{p.author}</div>
                      <div className="text-xs text-white/60 truncate">@{p.handle}</div>
                    </div>
                    <div className="ml-auto text-xs text-white/60">
                      {Intl.NumberFormat('en-US', { notation: 'compact' }).format(p.followers)} followers
                    </div>
                  </div>

                  {p.image && (
                    <div className="mb-2 rounded-lg overflow-hidden border border-white/10">
                      <img src={p.image} alt="" className="w-full h-36 object-cover" loading="lazy" />
                    </div>
                  )}

                  <div
                    className="text-sm text-white/90 line-clamp-5"
                    // Mastodon geeft veilige HTML terug (links/emojis). We houden het simpel:
                    dangerouslySetInnerHTML={{ __html: p.contentHtml }}
                  />

                  <div className="mt-3 flex items-center justify-between text-xs text-white/60">
                    <span>
                      ❤️ {p.favourites} · 🔁 {p.reblogs}
                    </span>
                    <time dateTime={p.createdAt}>
                      {new Date(p.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: '2-digit',
                      })}
                    </time>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </section>
  )
}