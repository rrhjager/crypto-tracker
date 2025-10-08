// src/pages/contact.tsx
import Head from 'next/head'
import { useState } from 'react'

type FormState = 'idle' | 'submitting' | 'success' | 'error'

export default function ContactPage() {
  const [state, setState] = useState<FormState>('idle')
  const [error, setError] = useState<string>('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setState('submitting')

    const form = e.currentTarget
    const formData = new FormData(form)
    const payload = Object.fromEntries(formData.entries())

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState('success')
      form.reset()
    } catch {
      setError('Something went wrong sending your message. Please try again later.')
      setState('error')
    }
  }

  return (
    <>
      <Head>
        <title>Contact us — SignalHub</title>
        <meta name="description" content="Get in touch with SignalHub." />
      </Head>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold text-white">Contact us</h1>
        <p className="mt-2 text-white/70">
          Questions, feedback, or partnership inquiries? Send us a message and we’ll get back to you.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-white">Full name</label>
            <input id="name" name="name" type="text" required
              className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
              placeholder="Jane Doe" autoComplete="name" />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-white">Email address</label>
            <input id="email" name="email" type="email" required
              className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
              placeholder="jane@example.com" autoComplete="email" />
          </div>

          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-white">Subject</label>
            <input id="subject" name="subject" type="text" required
              className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
              placeholder="Partnership inquiry" />
          </div>

          <div>
            <label htmlFor="message" className="block text-sm font-medium text-white">Message</label>
            <textarea id="message" name="message" required rows={6}
              className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
              placeholder="Tell us more…" />
          </div>

          <div className="pt-2 flex items-center gap-4">
            <button type="submit" disabled={state==='submitting'}
              className="rounded-lg bg-white text-black font-semibold px-5 py-2 disabled:opacity-60">
              {state==='submitting' ? 'Sending…' : 'Send message'}
            </button>

            {state==='success' && <span className="text-green-300 text-sm">Thanks! Your message has been sent.</span>}
            {state==='error' &&   <span className="text-red-300 text-sm">{error}</span>}
          </div>
        </form>
      </section>
    </>
  )
}