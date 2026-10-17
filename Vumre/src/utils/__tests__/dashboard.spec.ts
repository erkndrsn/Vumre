import { describe, expect, it } from 'vitest'
import { ratio, summarizeAccommodation, summarizeMoney } from '../dashboard'

const triple = { id: 1, name: 'Üçlü' }
const double = { id: 2, name: 'İkili' }
const region = { id: 7, name: 'Ankara' }

const rooms = [
  { id: 10, capacity: 3, active: true, roomType: triple },
  { id: 11, capacity: 3, active: true, roomType: triple },
  { id: 20, capacity: 2, active: true, roomType: double },
  { id: 21, capacity: 2, active: false, roomType: double },
]

const pilgrim = (
  room: number | null,
  extra: Partial<{ infant: boolean; female: boolean; age: number }> = {},
) => ({
  gender: extra.female ? ('female' as const) : ('male' as const),
  region: room === 20 ? null : region,
  room,
  age: extra.age ?? (extra.infant ? 0 : null),
  infant: extra.infant ?? false,
})

describe('summarizeAccommodation', () => {
  const s = summarizeAccommodation(rooms, [
    pilgrim(10),
    pilgrim(10, { female: true }),
    pilgrim(10, { female: true }),
    pilgrim(10, { infant: true }),
    pilgrim(11, { age: 8 }),
    pilgrim(20),
    pilgrim(null),
  ])

  it('umrecileri sayar; çocuk dahil, bebek ayrı sayılır', () => {
    expect(s).toMatchObject({
      pilgrims: 6,
      male: 3,
      female: 2,
      children: 1,
      infants: 1,
      assigned: 5,
      unassigned: 1,
    })
  })

  it('yalnız aktif odaları sayar; bebekler yatak tutmaz', () => {
    expect(s).toMatchObject({ rooms: 3, full: 1, partial: 2, empty: 0, beds: 8, occupiedBeds: 5 })
  })

  it('oda tiplerine göre ayırır', () => {
    expect(s.byType).toEqual([
      {
        key: '2',
        name: 'İkili',
        rooms: 1,
        full: 0,
        partial: 1,
        empty: 0,
        beds: 2,
        occupiedBeds: 1,
      },
      { key: '1', name: 'Üçlü', rooms: 2, full: 1, partial: 1, empty: 0, beds: 6, occupiedBeds: 4 },
    ])
  })

  it('bölgelere göre sayar', () => {
    expect(s.byRegion).toEqual([
      { name: 'Ankara', count: 5 },
      { name: 'Bölge seçilmemiş', count: 1 },
    ])
  })
})

describe('summarizeMoney', () => {
  it('para birimine göre toplam, tahsilat ve kalanı hesaplar', () => {
    expect(
      summarizeMoney([
        { currency: 'USD', price: 1800, paid: 1000, balance: 800 },
        { currency: 'USD', price: 900.1, paid: 900.2, balance: -0.1 },
        { currency: 'SAR', price: 500, paid: 0, balance: 500 },
        { currency: null, price: null, paid: 0, balance: 0 },
        // Odası belli olmadan alınmış ön ödeme: fazla ödeme sayılmaz.
        { currency: 'USD', price: null, paid: 250, balance: -250 },
      ]),
    ).toEqual([
      {
        currency: 'USD',
        total: 2700.1,
        paid: 2150.2,
        open: 800,
        openAccounts: 1,
        overpaid: 0.1,
        advance: 250,
      },
      { currency: 'SAR', total: 500, paid: 0, open: 500, openAccounts: 1, overpaid: 0, advance: 0 },
    ])
  })
})

describe('ratio', () => {
  it('payda sıfırsa 0, en fazla 1 döner', () => {
    expect(ratio(1, 0)).toBe(0)
    expect(ratio(3, 2)).toBe(1)
    expect(ratio(1, 4)).toBe(0.25)
  })
})
