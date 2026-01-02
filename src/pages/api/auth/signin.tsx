import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/router'

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const callbackUrl = (router.query.callbackUrl as string) || '/'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await signIn('email', { email, callbackUrl, redirect: false })
    setLoading(false)
    setSent(Boolean(res?.ok))
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-white">Sign in</h1>
      <p className="mt-2 text-white/70">We’ll send you a magic link.</p>

      <form onSubmit={onSubmit} className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
        <label className="block text-sm text-white/70">Email</label>
        <input
          className="mt-2 w-full rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-white outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="you@domain.com"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full rounded-xl bg-white text-black font-semibold py-2 disabled:opacity-60"
        >
          {loading ? 'Sending…' : 'Send magic link'}
        </button>

        {sent && (
          <div className="mt-3 text-sm text-emerald-300">
            Check your email for the sign-in link.
          </div>
        )}
      </form>
    </div>
  )
}