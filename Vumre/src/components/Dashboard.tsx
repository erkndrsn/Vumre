import type { ServerProps } from 'payload'
import React from 'react'

import { relationId, roomStatus, type RoomStatus } from '../lib/rooms'
import { isInfant } from '../utils/childPricing'
import './Dashboard.scss'

const num = new Intl.NumberFormat('tr-TR')
const pct = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 })

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${num.format(amount)} ${currency}`
  }
}

const STATUS_LABELS: Record<RoomStatus, string> = {
  empty: 'Boş',
  partial: 'Kısmen dolu',
  full: 'Dolu',
}

type Bar = { label: string; value: number; max: number; note?: string }

/** Admin panelinin ana sayfasında konaklama özetini gösterir. */
export async function Dashboard({ payload, user }: ServerProps) {
  const admin = payload.config.routes.admin

  const [{ docs: pilgrims }, { docs: rooms }, { docs: roomTypes }, { docs: regions }] =
    await Promise.all([
      payload.find({
        collection: 'pilgrims',
        where: { archived: { not_equals: true } },
        select: {
          room: true,
          region: true,
          gender: true,
          birthDate: true,
          roomPrice: true,
          roomCurrency: true,
        },
        pagination: false,
        depth: 0,
      }),
      payload.find({
        collection: 'rooms',
        select: { roomType: true, capacity: true, active: true },
        pagination: false,
        depth: 0,
        context: { skipOccupancy: true },
      }),
      payload.find({
        collection: 'room-types',
        select: { name: true },
        pagination: false,
        depth: 0,
      }),
      payload.find({
        collection: 'regions',
        select: { name: true },
        pagination: false,
        depth: 0,
      }),
    ])

  // Oda başına doluluk; bebekler (0-1 yaş) yatak tutmaz.
  const occupiedByRoom = new Map<string, number>()
  const revenue = new Map<string, number>()
  const byRegion = new Map<string, number>()
  let assigned = 0
  let male = 0
  let female = 0
  for (const p of pilgrims) {
    const roomId = relationId(p.room)
    if (roomId !== null) {
      assigned++
      if (!isInfant(p.birthDate)) {
        occupiedByRoom.set(String(roomId), (occupiedByRoom.get(String(roomId)) ?? 0) + 1)
      }
      if (p.roomPrice && p.roomCurrency) {
        revenue.set(p.roomCurrency, (revenue.get(p.roomCurrency) ?? 0) + p.roomPrice)
      }
    }
    const regionId = relationId(p.region)
    const regionKey = regionId === null ? '' : String(regionId)
    byRegion.set(regionKey, (byRegion.get(regionKey) ?? 0) + 1)
    if (p.gender === 'male') male++
    else if (p.gender === 'female') female++
  }

  const activeRooms = rooms.filter((r) => r.active !== false)
  const statusCounts: Record<RoomStatus, number> = { empty: 0, partial: 0, full: 0 }
  let totalBeds = 0
  let occupiedBeds = 0
  const byType = new Map<string, { beds: number; occupied: number; rooms: number }>()
  for (const r of activeRooms) {
    const capacity = r.capacity ?? 0
    const occupied = occupiedByRoom.get(String(r.id)) ?? 0
    totalBeds += capacity
    occupiedBeds += Math.min(occupied, capacity)
    statusCounts[roomStatus(occupied, capacity)]++
    const typeKey = String(relationId(r.roomType))
    const t = byType.get(typeKey) ?? { beds: 0, occupied: 0, rooms: 0 }
    t.beds += capacity
    t.occupied += occupied
    t.rooms++
    byType.set(typeKey, t)
  }
  const freeBeds = Math.max(totalBeds - occupiedBeds, 0)
  const occupancy = totalBeds ? occupiedBeds / totalBeds : 0
  const unassigned = pilgrims.length - assigned

  const regionNames = new Map(regions.map((r) => [String(r.id), r.name]))
  const regionBars: Bar[] = [...byRegion.entries()]
    .map(([id, value]) => ({
      label: id ? (regionNames.get(id) ?? 'Bilinmeyen bölge') : 'Bölge seçilmemiş',
      value,
      max: pilgrims.length,
    }))
    .sort((a, b) => b.value - a.value)

  const typeNames = new Map(roomTypes.map((t) => [String(t.id), t.name]))
  const typeBars: Bar[] = [...byType.entries()]
    .map(([id, t]) => ({
      label: typeNames.get(id) ?? 'Bilinmeyen tip',
      value: t.occupied,
      max: t.beds,
      note: `${num.format(t.rooms)} oda`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))

  return (
    <section className="vumre-dashboard" aria-label="Konaklama özeti">
      <header className="vumre-dashboard__header">
        <div>
          <h2>Konaklama özeti</h2>
          {user?.username && (
            <p className="vumre-dashboard__muted">{user.username} olarak giriş yaptınız.</p>
          )}
        </div>
        <nav className="vumre-dashboard__actions" aria-label="Hızlı işlemler">
          <a
            className="btn btn--style-primary btn--size-small"
            href={`${admin}/collections/pilgrims/create`}
          >
            Yeni umreci
          </a>
          <a
            className="btn btn--style-secondary btn--size-small"
            href={`${admin}/collections/rooms/create`}
          >
            Yeni oda
          </a>
        </nav>
      </header>

      <div className="vumre-dashboard__tiles">
        <Tile
          label="Umreci"
          value={num.format(pilgrims.length)}
          detail={`${num.format(male)} erkek · ${num.format(female)} kadın`}
          href={`${admin}/collections/pilgrims`}
        />
        <Tile
          label="Odası atanmamış"
          value={num.format(unassigned)}
          detail={unassigned ? 'Odaya atanmayı bekliyor' : 'Herkes bir odaya atandı'}
          href={`${admin}/collections/pilgrims?where[room][exists]=false&where[archived][not_equals]=true`}
        />
        <Tile
          label="Yatak doluluğu"
          value={pct.format(occupancy)}
          detail={`${num.format(occupiedBeds)} / ${num.format(totalBeds)} yatak dolu`}
          meter={occupancy}
        />
        <Tile
          label="Boş yatak"
          value={num.format(freeBeds)}
          detail={`${num.format(activeRooms.length)} aktif oda`}
          href={`${admin}/collections/rooms`}
        />
      </div>

      <div className="vumre-dashboard__panels">
        <Panel title="Oda durumu">
          {activeRooms.length === 0 ? (
            <Empty>Henüz aktif oda yok.</Empty>
          ) : (
            <>
              <div className="vumre-dashboard__stack" role="img" aria-label="Oda durumu dağılımı">
                {(['full', 'partial', 'empty'] as const).map((s) =>
                  statusCounts[s] ? (
                    <span
                      key={s}
                      className={`vumre-dashboard__seg vumre-dashboard__seg--${s}`}
                      style={{ flexGrow: statusCounts[s] }}
                      title={`${STATUS_LABELS[s]}: ${num.format(statusCounts[s])} oda`}
                    />
                  ) : null,
                )}
              </div>
              <ul className="vumre-dashboard__legend">
                {(['full', 'partial', 'empty'] as const).map((s) => (
                  <li key={s}>
                    <span className={`vumre-dashboard__swatch vumre-dashboard__seg--${s}`} />
                    {STATUS_LABELS[s]}
                    <strong>{num.format(statusCounts[s])}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Ödenecek oda ücretleri">
          {revenue.size === 0 ? (
            <Empty>Odaya atanmış umreci yok.</Empty>
          ) : (
            <ul className="vumre-dashboard__money">
              {[...revenue.entries()].map(([currency, amount]) => (
                <li key={currency}>
                  <span className="vumre-dashboard__muted">{currency}</span>
                  <strong>{money(amount, currency)}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="vumre-dashboard__muted vumre-dashboard__note">
            Odaya atanan umrecilerin kişi başı ücretlerinin toplamı.
          </p>
        </Panel>

        <Panel title="Bölgelere göre umreciler">
          {regionBars.length === 0 ? (
            <Empty>Henüz umreci kaydı yok.</Empty>
          ) : (
            <Bars bars={regionBars} format={(b) => num.format(b.value)} />
          )}
        </Panel>

        <Panel title="Oda tiplerine göre doluluk">
          {typeBars.length === 0 ? (
            <Empty>Henüz aktif oda yok.</Empty>
          ) : (
            <Bars bars={typeBars} format={(b) => `${num.format(b.value)} / ${num.format(b.max)}`} />
          )}
        </Panel>
      </div>
    </section>
  )
}

function Tile({
  label,
  value,
  detail,
  href,
  meter,
}: {
  label: string
  value: string
  detail: string
  href?: string
  meter?: number
}) {
  const body = (
    <>
      <span className="vumre-dashboard__muted">{label}</span>
      <strong className="vumre-dashboard__value">{value}</strong>
      {meter !== undefined && (
        <span className="vumre-dashboard__track" aria-hidden>
          <span
            className="vumre-dashboard__fill"
            style={{ width: `${Math.round(meter * 100)}%` }}
          />
        </span>
      )}
      <span className="vumre-dashboard__muted">{detail}</span>
    </>
  )
  return href ? (
    <a className="vumre-dashboard__tile vumre-dashboard__tile--link" href={href}>
      {body}
    </a>
  ) : (
    <div className="vumre-dashboard__tile">{body}</div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="vumre-dashboard__panel">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="vumre-dashboard__muted">{children}</p>
}

function Bars({ bars, format }: { bars: Bar[]; format: (b: Bar) => string }) {
  return (
    <ul className="vumre-dashboard__bars">
      {bars.map((b) => {
        const ratio = b.max ? b.value / b.max : 0
        return (
          <li key={b.label} title={`${b.label}: ${format(b)}${b.note ? ` · ${b.note}` : ''}`}>
            <div className="vumre-dashboard__bar-head">
              <span>
                {b.label}
                {b.note && <span className="vumre-dashboard__muted"> · {b.note}</span>}
              </span>
              <strong>{format(b)}</strong>
            </div>
            <span className="vumre-dashboard__track">
              <span
                className="vumre-dashboard__fill"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
