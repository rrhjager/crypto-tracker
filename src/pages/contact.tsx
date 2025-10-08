// src/pages/contact.tsx
import Head from 'next/head'

export default function ContactPage() {
  return (
    <>
      <Head>
        <title>Contact us — SignalHub</title>
        <meta name="description" content="Get in touch with SignalHub." />
      </Head>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold text-white">Contact us</h1>
        <p className="mt-2 text-white/70">
          This is a placeholder contact page. We’ll wire up email sending later.
        </p>
      </section>
    </>
  )
}