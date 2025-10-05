/* =========================
   File: src/pages/contact.tsx
   ========================= */
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
       } catch (err: any) {
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
               <input
                 id="name" name="name" type="text" required
                 className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
                 placeholder="Jane Doe"
                 autoComplete="name"
               />
             </div>
   
             <div>
               <label htmlFor="email" className="block text-sm font-medium text-white">Email address</label>
               <input
                 id="email" name="email" type="email" required
                 className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
                 placeholder="jane@example.com"
                 autoComplete="email"
               />
             </div>
   
             <div>
               <label htmlFor="subject" className="block text-sm font-medium text-white">Subject</label>
               <input
                 id="subject" name="subject" type="text" required
                 className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
                 placeholder="Partnership inquiry"
               />
             </div>
   
             <div>
               <label htmlFor="message" className="block text-sm font-medium text-white">Message</label>
               <textarea
                 id="message" name="message" required rows={6}
                 className="mt-2 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-white/30"
                 placeholder="Tell us more…"
               />
             </div>
   
             <div className="pt-2 flex items-center gap-4">
               <button
                 type="submit"
                 disabled={state==='submitting'}
                 className="rounded-lg bg-white text-black font-semibold px-5 py-2 disabled:opacity-60"
               >
                 {state==='submitting' ? 'Sending…' : 'Send message'}
               </button>
   
               {state==='success' && (
                 <span className="text-green-300 text-sm">Thanks! Your message has been sent.</span>
               )}
               {state==='error' && (
                 <span className="text-red-300 text-sm">{error}</span>
               )}
             </div>
           </form>
         </section>
       </>
     )
   }
   
   /* =================================
      File: src/pages/api/contact.ts
      =================================
      Serverless mailer using Nodemailer.
      Configure these env vars in .env (or Vercel project settings):
        SMTP_HOST=smtp.gmail.com
        SMTP_PORT=465
        SMTP_USER=your_gmail_address
        SMTP_PASS=your_app_password   (use a Gmail App Password)
        CONTACT_TO=kaartenautomaat@gmail.com  (optional; defaults to this address)
   */
   import type { NextApiRequest, NextApiResponse } from 'next'
   import nodemailer from 'nodemailer'
   
   export default async function handler(req: NextApiRequest, res: NextApiResponse) {
     if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
   
     try {
       const { name, email, subject, message } = req.body || {}
       if (!name || !email || !subject || !message) {
         return res.status(400).json({ error: 'Missing fields' })
       }
   
       // Create transporter from env
       const transporter = nodemailer.createTransport({
         host: process.env.SMTP_HOST,
         port: Number(process.env.SMTP_PORT || 465),
         secure: true,
         auth: {
           user: process.env.SMTP_USER,
           pass: process.env.SMTP_PASS,
         },
       })
   
       const to = process.env.CONTACT_TO || 'kaartenautomaat@gmail.com'
       const html = `
         <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
           <h2 style="margin:0 0 8px">New contact form submission</h2>
           <p style="margin:0 0 16px;color:#555">From the SignalHub website</p>
           <table style="border-collapse:collapse">
             <tr><td style="padding:4px 8px;font-weight:600">Name</td><td style="padding:4px 8px">${escapeHtml(name)}</td></tr>
             <tr><td style="padding:4px 8px;font-weight:600">Email</td><td style="padding:4px 8px">${escapeHtml(email)}</td></tr>
             <tr><td style="padding:4px 8px;font-weight:600">Subject</td><td style="padding:4px 8px">${escapeHtml(subject)}</td></tr>
           </table>
           <div style="margin-top:16px;padding:12px;border:1px solid #eee;border-radius:8px;white-space:pre-wrap">${escapeHtml(message)}</div>
         </div>
       `
   
       // Send to you
       await transporter.sendMail({
         from: `"SignalHub Contact" <${process.env.SMTP_USER}>`,
         to,
         subject: `[SignalHub] ${subject} — ${name}`,
         replyTo: `${name} <${email}>`,
         html,
       })
   
       // Optional: send a copy to the sender (acknowledgement)
       try {
         await transporter.sendMail({
           from: `"SignalHub" <${process.env.SMTP_USER}>`,
           to: email,
           subject: `We received your message: ${subject}`,
           html: `
             <p>Hi ${escapeHtml(name)},</p>
             <p>Thanks for reaching out. We've received your message and will get back to you.</p>
             <hr/>
             <p><strong>Your message</strong></p>
             <pre style="white-space:pre-wrap">${escapeHtml(message)}</pre>
             <p style="color:#777">— SignalHub</p>
           `,
         })
       } catch {}
   
       return res.status(200).json({ ok: true })
     } catch (err: any) {
       console.error('Contact API error:', err)
       return res.status(500).json({ error: 'Failed to send' })
     }
   }
   
   function escapeHtml(s: string) {
     return String(s)
       .replaceAll('&','&amp;')
       .replaceAll('<','&lt;')
       .replaceAll('>','&gt;')
       .replaceAll('"','&quot;')
       .replaceAll("'",'&#39;')
   }