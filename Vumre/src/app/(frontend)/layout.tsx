import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Umre konaklama ve oda yönetimi',
  title: 'Vumre',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="tr">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
