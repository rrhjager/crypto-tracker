// src/components/SocialCarousel.tsx
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Item = {
  id: string
  url: string
  createdAt: string
  text: string
  author: { handle: string; name: string; avatar: string; followers: number; profileUrl: string }
  image?: string | null
  source: 'mastodon'
  instance: string
  tag: string
}

export default function SocialCarousel({
  api = '/api/social/masto?tag=stocks&minFollowers=100000',
  title = 'Social Buzz',
}: {
  api?: string
  title?: string
}) {
  const [items, setItems] = useState<Item[]>([])
  const [err, setErr] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

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

  const scrollBy = (dx: number) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dx, behavior: 'smooth' })
  }

  return (
    <div className="table-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-gray-900">{title}</div>
        <div className="flex gap-2">
          <button
            onClick={() => scrollBy(-380)}
            className="rounded-lg border px-2 py-1 text-sm text-gray-700 bg-white hover:bg-gray-50"
          >
            ←
          </button>
          <button
            onClick={() => scrollBy(380)}
            className="rounded-lg border px-2 py-1 text-sm text-gray-700 bg-white hover:bg-gray-50"
          >
            →
          </button>
        </div>
      </div>

      {err ? (
        <div className="text-sm text-red-600">Failed to load: {err}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">No posts found (try a different tag or lower minFollowers).</div>
      ) : (
        <div
          ref={scrollerRef}
          className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory [scrollbar-width:none]"
          style={{ scrollbarWidth: 'none' }}
        >
          {items.map((it) => (
            <article
              key={it.id}
              className="min-w-[340px] max-w-[340px] snap-start rounded-2xl border bg-white overflow-hidden"
            >
              {it.image ? (
                <a href={it.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.image} alt="" className="w-full h-[160px] object-cover" />
                </a>
              ) : null}
              <div className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.author.avatar} alt="" className="w-8 h-8 rounded-full border" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{it.author.name || it.author.handle}</div>
                    <div className="text-xs text-gray-500 truncate">@{it.author.handle} · {Intl.NumberFormat('en-US').format(it.author.followers)} followers</div>
                  </div>
                </div>
                <p className="text-sm text-gray-800 line-clamp-5">{it.text}</p>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{new Date(it.createdAt).toLocaleString()}</span>
                  <a className="text-blue-600 hover:underline" href={it.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}