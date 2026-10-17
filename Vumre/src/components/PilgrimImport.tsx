'use client'

import { Button, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useRef, useState } from 'react'

import type { ImportResult } from '../lib/pilgrimImport'

type State =
  | { status: 'idle' }
  | { status: 'busy'; message: string }
  | { status: 'error'; message: string }
  | { status: 'preview'; result: ImportResult }
  | { status: 'done'; result: ImportResult }

/** Umreciler listesinin üstünde: Excel şablonu indirme, önizleme ve toplu içe aktarma. */
export function PilgrimImport() {
  const {
    config: { serverURL, routes },
  } = useConfig()
  const router = useRouter()
  const api = `${serverURL}${routes.api}/pilgrims`
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<State>({ status: 'idle' })

  const send = async (selected: File, dryRun: boolean) => {
    setState({
      status: 'busy',
      message: dryRun ? 'Dosya kontrol ediliyor…' : 'Kayıtlar aktarılıyor…',
    })
    const body = new FormData()
    body.append('file', selected)
    try {
      const res = await fetch(`${api}/import${dryRun ? '?dryRun=1' : ''}`, {
        method: 'POST',
        credentials: 'include',
        body,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(
          data?.errors?.[0]?.message || data?.message || `İstek başarısız (${res.status})`,
        )
      }
      const result = data as ImportResult
      setState({ status: dryRun ? 'preview' : 'done', result })
      if (!dryRun && result.ok > 0) router.refresh()
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Yükleme başarısız.' })
    }
  }

  const reset = () => {
    setFile(null)
    setState({ status: 'idle' })
    if (inputRef.current) inputRef.current.value = ''
  }

  // Şablon, sistemdeki güncel bölge listesiyle sunucuda üretilir (GET /api/pilgrims/import-template).
  const templateButton = (
    <Button
      el="anchor"
      url={`${api}/import-template`}
      buttonStyle="secondary"
      size="small"
      margin={false}
    >
      Excel şablonunu indir
    </Button>
  )

  if (!open) {
    return (
      <div style={styles.bar}>
        <Button
          el="anchor"
          url={`${api}/export`}
          buttonStyle="secondary"
          size="small"
          margin={false}
        >
          Excel'e aktar
        </Button>
        {templateButton}
        <Button buttonStyle="secondary" size="small" margin={false} onClick={() => setOpen(true)}>
          Excel ile toplu yükle
        </Button>
      </div>
    )
  }

  return (
    <div style={styles.box}>
      <div style={styles.header}>
        <strong>Excel ile toplu umreci yükleme</strong>
        <Button
          buttonStyle="none"
          size="small"
          margin={false}
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          Kapat
        </Button>
      </div>

      <p style={styles.muted}>
        1) Excel şablonunu indirin ve kişileri doldurun. 2) Dosyayı seçin; kayıtlar önce kontrol
        edilir. 3) Sonucu inceleyip içe aktarın. Hatalı satırlar aktarılmaz.
      </p>

      <div style={styles.row}>
        {templateButton}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={state.status === 'busy'}
          onChange={(e) => {
            const selected = e.target.files?.[0] ?? null
            setFile(selected)
            if (selected) void send(selected, true)
            else setState({ status: 'idle' })
          }}
        />
      </div>

      {state.status === 'busy' && <p style={styles.muted}>{state.message}</p>}
      {state.status === 'error' && <p style={styles.error}>{state.message}</p>}

      {state.status === 'preview' && (
        <>
          <p>
            Dosyada <strong>{state.result.total}</strong> kişi var:{' '}
            <strong style={styles.success}>{state.result.ok} kayıt eklenebilir</strong>
            {state.result.failed > 0 && (
              <>
                , <strong style={styles.errorText}>{state.result.failed} satır hatalı</strong>
              </>
            )}
            .
          </p>
          {state.result.newGroups.length > 0 && (
            <p style={styles.muted}>
              Oluşturulacak ödeme grupları: {state.result.newGroups.join(', ')}
            </p>
          )}
          <ErrorTable result={state.result} />
          <div style={styles.row}>
            <Button
              size="small"
              margin={false}
              disabled={!file || state.result.ok === 0}
              onClick={() => file && void send(file, false)}
            >
              {state.result.ok} kaydı içe aktar
            </Button>
            <Button buttonStyle="secondary" size="small" margin={false} onClick={reset}>
              Vazgeç
            </Button>
          </div>
        </>
      )}

      {state.status === 'done' && (
        <>
          <p>
            <strong style={styles.success}>{state.result.ok} umreci eklendi.</strong>
            {state.result.failed > 0 && (
              <>
                {' '}
                <strong style={styles.errorText}>{state.result.failed} satır aktarılmadı.</strong>
              </>
            )}
          </p>
          {state.result.newGroups.length > 0 && (
            <p style={styles.muted}>
              Oluşturulan ödeme grupları: {state.result.newGroups.join(', ')}
            </p>
          )}
          <ErrorTable result={state.result} />
          <div style={styles.row}>
            <Button buttonStyle="secondary" size="small" margin={false} onClick={reset}>
              Yeni dosya yükle
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function ErrorTable({ result }: { result: ImportResult }) {
  const failed = result.rows.filter((r) => r.status === 'error')
  if (!failed.length) return null
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Satır</th>
            <th style={styles.th}>Ad Soyad</th>
            <th style={styles.th}>Hata</th>
          </tr>
        </thead>
        <tbody>
          {failed.map((r) => (
            <tr key={r.row}>
              <td style={styles.td}>{r.row}</td>
              <td style={styles.td}>{r.fullName || '—'}</td>
              <td style={styles.td}>{r.errors.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'calc(var(--base) * 0.5)',
    marginBottom: 'var(--base)',
  },
  box: {
    marginBottom: 'var(--base)',
    padding: 'var(--base)',
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: 'var(--style-radius-s)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--base) * 0.6)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  row: { display: 'flex', gap: 'calc(var(--base) * 0.5)', alignItems: 'center', flexWrap: 'wrap' },
  muted: { margin: 0, color: 'var(--theme-elevation-500)' },
  error: { margin: 0, color: 'var(--theme-error-500)', fontWeight: 600 },
  errorText: { color: 'var(--theme-error-500)' },
  success: { color: 'var(--theme-success-500)' },
  tableWrap: { maxHeight: 320, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: '1px solid var(--theme-elevation-150)',
    position: 'sticky',
    top: 0,
    background: 'var(--theme-bg)',
  },
  td: {
    padding: '6px 8px',
    borderBottom: '1px solid var(--theme-elevation-100)',
    verticalAlign: 'top',
  },
}
