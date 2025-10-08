// src/pages/api/contact.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import nodemailer from 'nodemailer'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { name, email, subject, message } = req.body || {}
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Missing fields' })
    }

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
        <table style="border-collapse:collapse">
          <tr><td style="padding:4px 8px;font-weight:600">Name</td><td style="padding:4px 8px">${escapeHtml(name)}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:600">Email</td><td style="padding:4px 8px">${escapeHtml(email)}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:600">Subject</td><td style="padding:4px 8px">${escapeHtml(subject)}</td></tr>
        </table>
        <div style="margin-top:16px;padding:12px;border:1px solid #eee;border-radius:8px;white-space:pre-wrap">${escapeHtml(message)}</div>
      </div>
    `

    await transporter.sendMail({
      from: `"SignalHub Contact" <${process.env.SMTP_USER}>`,
      to,
      subject: `[SignalHub] ${subject} — ${name}`,
      replyTo: `${name} <${email}>`,
      html,
    })

    try {
      await transporter.sendMail({
        from: `"SignalHub" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `We received your message: ${subject}`,
        html: `<p>Hi ${escapeHtml(name)},</p><p>Thanks for reaching out. We'll get back to you.</p>`,
      })
    } catch {}

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to send' })
  }
}

function escapeHtml(s: string) {
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;')
}