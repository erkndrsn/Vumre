import { headers as getHeaders } from 'next/headers.js'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

export default async function HomePage() {
  const headers = await getHeaders()
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const { user } = await payload.auth({ headers })

  return (
    <div className="home">
      <div className="content">
        {!user && <h1>Vumre&apos;ye hoş geldiniz</h1>}
        {user && <h1>Tekrar hoş geldiniz, {user.email}</h1>}
        <p className="lead">Umre konaklama ve oda yönetimi</p>
        <div className="links">
          <a className="admin" href={payloadConfig.routes.admin}>
            {user ? 'Yönetim paneline git' : 'Giriş yap'}
          </a>
        </div>
      </div>
      <div className="footer">
        <p>Vumre · Umre konaklama yönetimi</p>
      </div>
    </div>
  )
}
