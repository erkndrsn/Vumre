'use client'

import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import type { Pilgrim, Room, RoomType } from '../payload-types'
import { isInfant } from '../utils/childPricing'

const GENDER_LABELS: Record<string, string> = { male: 'Erkek', female: 'Kadın' }

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; room: Room; occupants: Pilgrim[] }

/** Umreci formunda seçilen odada kimlerin kaldığını ve odanın doluluğunu gösterir. */
export function RoomOccupants() {
  const { id } = useDocumentInfo()
  const {
    config: { serverURL, routes },
  } = useConfig()
  const roomValue = useFormFields(([fields]) => fields.room?.value)
  const gender = useFormFields(([fields]) => fields.gender?.value) as string | undefined
  const birthDate = useFormFields(([fields]) => fields.birthDate?.value) as string | undefined
  const roomId =
    roomValue && typeof roomValue === 'object' ? (roomValue as { id?: number }).id : roomValue

  const [state, setState] = useState<State>({ status: 'idle' })

  useEffect(() => {
    if (!roomId) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    const api = `${serverURL}${routes.api}`
    const get = async <T,>(path: string): Promise<T> => {
      const res = await fetch(`${api}${path}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`İstek başarısız (${res.status})`)
      return res.json()
    }

    setState({ status: 'loading' })
    Promise.all([
      get<Room>(`/rooms/${roomId}?depth=1`),
      get<{ docs: Pilgrim[] }>(
        `/pilgrims?where[room][equals]=${roomId}&limit=0&depth=1&sort=fullName`,
      ),
    ])
      .then(([room, { docs }]) => setState({ status: 'ready', room, occupants: docs }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: e instanceof Error ? e.message : 'Yüklenemedi' })
        }
      })
    return () => controller.abort()
  }, [roomId, serverURL, routes.api])

  if (state.status === 'idle') return null

  return (
    <div style={styles.box}>
      <strong style={styles.title}>Odada kalanlar</strong>
      {state.status === 'loading' && <p style={styles.muted}>Yükleniyor…</p>}
      {state.status === 'error' && <p style={styles.error}>{state.message}</p>}
      {state.status === 'ready' && (
        <Details {...state} selfId={id} gender={gender} selfInfant={isInfant(birthDate)} />
      )}
    </div>
  )
}

function Details({
  room,
  occupants,
  selfId,
  gender,
  selfInfant,
}: {
  room: Room
  occupants: Pilgrim[]
  selfId?: number | string
  gender?: string
  selfInfant: boolean
}) {
  const roomType = typeof room.roomType === 'object' ? (room.roomType as RoomType) : null
  const capacity = room.capacity ?? roomType?.capacity ?? 0
  const others = occupants.filter((p) => String(p.id) !== String(selfId))
  const isSelfHere = others.length !== occupants.length
  // Bebekler (0-1 yaş) yatak tutmaz; doluluk yalnızca yatak tutanlarla hesaplanır.
  const bedsOf = (list: Pilgrim[]) => list.filter((p) => !isInfant(p.birthDate)).length
  const othersBeds = bedsOf(others)
  const infantCount = occupants.length - bedsOf(occupants)
  // Bu kişi odaya eklendiğinde oluşacak doluluk.
  const after = othersBeds + (selfInfant ? 0 : 1)
  const full = !selfInfant && othersBeds >= capacity
  const otherGender = gender ? others.filter((p) => p.gender && p.gender !== gender) : []

  return (
    <>
      <p style={styles.muted}>
        Oda {room.roomNumber}
        {roomType ? ` · ${roomType.name}` : ''}
      </p>
      <p>
        Doluluk:{' '}
        <strong>
          {bedsOf(occupants)}/{capacity}
        </strong>
        {infantCount > 0 && <span style={styles.muted}> + {infantCount} bebek</span>}
        {!isSelfHere && !full && (
          <span style={styles.muted}>
            {' '}
            → kaydedince {after}/{capacity}
          </span>
        )}
      </p>

      {others.length === 0 ? (
        <p style={styles.muted}>Odada henüz kimse yok.</p>
      ) : (
        <ol style={styles.list}>
          {others.map((p) => (
            <li key={p.id}>
              <a href={`./${p.id}`} target="_blank" rel="noreferrer">
                {p.fullName || `${p.firstName} ${p.lastName}`}
              </a>
              <span style={styles.muted}>
                {' '}
                · {GENDER_LABELS[p.gender] ?? p.gender}
                {isInfant(p.birthDate) ? ' · bebek' : ''}
                {p.region && typeof p.region === 'object' ? ` · ${p.region.name}` : ''}
                {p.phone ? ` · ${p.phone}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}

      {full && !isSelfHere && (
        <p style={styles.error}>
          Bu oda dolu ({othersBeds}/{capacity}). Bu odaya ekleme yapılamaz, başka bir oda seçin.
        </p>
      )}
      {selfInfant && !isSelfHere && (
        <p style={styles.muted}>Bebek (0-1 yaş) yatak tutmaz; oda dolu olsa da eklenebilir.</p>
      )}
      {otherGender.length > 0 && (
        <p style={styles.warning}>
          Dikkat: Odada farklı cinsiyetten {otherGender.length} kişi var.
        </p>
      )}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    marginBottom: 'var(--base)',
    padding: 'calc(var(--base) * 0.75)',
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: 'var(--style-radius-s)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--base) * 0.4)',
  },
  title: { fontSize: '0.95rem' },
  muted: { margin: 0, color: 'var(--theme-elevation-500)' },
  list: { margin: 0, paddingLeft: '1.25rem' },
  error: { margin: 0, color: 'var(--theme-error-500)', fontWeight: 600 },
  warning: { margin: 0, color: 'var(--theme-warning-500)' },
}
