import { describe, expect, it } from 'vitest'
import { buildLedger, summarizeCashboxes, totalsByCurrency, type LedgerMovement } from '../cash'

const boxes = [
  { id: 1, name: 'Nakit USD', currency: 'USD', kind: 'cash' as const, active: true },
  { id: 2, name: 'Banka USD', currency: 'USD', kind: 'transfer' as const, active: true },
  { id: 3, name: 'Nakit SAR', currency: 'SAR', kind: 'cash' as const, active: true },
  { id: 4, name: 'Eski kasa', currency: 'EUR', kind: 'cash' as const, active: false },
]

describe('summarizeCashboxes', () => {
  it('tahsilat, gider ve iki yönlü virmanla kasa bakiyesini hesaplar', () => {
    const s = summarizeCashboxes(
      boxes,
      [
        { cashbox: 1, amount: 1000 },
        { cashbox: { id: 1 }, amount: 500.1 },
        { cashbox: 2, amount: 300 },
      ],
      [
        { cashbox: 1, amount: 200.2 },
        { cashbox: 3, amount: 50 },
      ],
      [
        { from: 1, to: 2, amount: 400, toAmount: 400 },
        // Farklı döviz: kaynaktan USD çıkar, hedefe SAR girer.
        { from: 2, to: 3, amount: 100, toAmount: 375 },
      ],
    )
    const byId = Object.fromEntries(s.map((b) => [b.id, b]))
    expect(byId[1]).toMatchObject({
      income: 1500.1,
      expense: 200.2,
      transferOut: 400,
      balance: 899.9,
    })
    expect(byId[2]).toMatchObject({ income: 300, transferIn: 400, transferOut: 100, balance: 600 })
    expect(byId[3]).toMatchObject({ expense: 50, transferIn: 375, balance: 325 })
    expect(byId[4]).toMatchObject({ balance: 0, active: false })
    // Aktif kasalar önce; sonra döviz ve ad sırası.
    expect(s.map((b) => b.name)).toEqual(['Nakit SAR', 'Banka USD', 'Nakit USD', 'Eski kasa'])
  })

  it('bilinmeyen kasaya bağlı hareketi saymaz, eksi bakiyeye izin verir', () => {
    const [box] = summarizeCashboxes(
      [boxes[0]!],
      [
        { cashbox: 99, amount: 1000 },
        { cashbox: null, amount: 5 },
      ],
      [{ cashbox: 1, amount: 10 }],
      [],
    )
    expect(box!.balance).toBe(-10)
  })
})

describe('totalsByCurrency', () => {
  it('kasaları döviz bazında toplar', () => {
    const s = summarizeCashboxes(
      boxes.slice(0, 3),
      [
        { cashbox: 1, amount: 100 },
        { cashbox: 2, amount: 0.2 },
        { cashbox: 3, amount: 50 },
      ],
      [],
      [],
    )
    expect(totalsByCurrency(s)).toEqual([
      { currency: 'SAR', balance: 50, cashboxCount: 1 },
      { currency: 'USD', balance: 100.2, cashboxCount: 2 },
    ])
  })
})

describe('buildLedger', () => {
  const movements: LedgerMovement[] = [
    { type: 'expense', id: 1, date: '2026-03-05T12:00:00.000Z', description: 'Otel', amount: 300 },
    { type: 'payment', id: 1, date: '2026-03-01T12:00:00.000Z', description: 'Ali', amount: 1000 },
    {
      type: 'transfer-out',
      id: 1,
      date: '2026-03-10T12:00:00.000Z',
      description: '→ Banka',
      amount: 200,
    },
    { type: 'payment', id: 2, date: '2026-03-05T12:00:00.000Z', description: 'Veli', amount: 50.5 },
  ]

  it('tarih sırasıyla yürüyen bakiye çıkarır; aynı günde giriş önce gelir', () => {
    const l = buildLedger(movements)
    expect(l.entries.map((e) => [e.description, e.in, e.out, e.balance])).toEqual([
      ['Ali', 1000, 0, 1000],
      ['Veli', 50.5, 0, 1050.5],
      ['Otel', 0, 300, 750.5],
      ['→ Banka', 0, 200, 550.5],
    ])
    expect(l).toMatchObject({ opening: 0, totalIn: 1050.5, totalOut: 500, closing: 550.5 })
  })

  it('başlangıçtan önceki hareketleri devreden bakiyeye toplar, bitişten sonrakileri almaz', () => {
    const l = buildLedger(movements, { from: '2026-03-05', to: '2026-03-05' })
    expect(l.opening).toBe(1000)
    expect(l.entries.map((e) => e.description)).toEqual(['Veli', 'Otel'])
    expect(l).toMatchObject({ totalIn: 50.5, totalOut: 300, closing: 750.5 })
  })
})
