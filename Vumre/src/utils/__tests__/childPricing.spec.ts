import { describe, expect, it } from 'vitest'
import {
  agePriceError,
  ageOn,
  isInfant,
  otherPriceError,
  otherPricesForAge,
  priceForAge,
} from '../childPricing'

const threeBed = {
  pricePerPerson: 1800,
  childPrices: [
    { minAge: 7, maxAge: 12, price: 900 },
    { minAge: 0, maxAge: 1, price: 350 },
    { minAge: 2, maxAge: 6, price: 500 },
  ],
}

describe('ageOn', () => {
  const on = new Date('2026-10-09T12:00:00Z')

  it('doğum günü gelmeden yaşı bir eksik sayar', () => {
    expect(ageOn('2020-10-09', on)).toBe(6)
    expect(ageOn('2020-10-10', on)).toBe(5)
    expect(ageOn('2026-03-01T09:00:00.000Z', on)).toBe(0)
  })

  it('doğum tarihi yoksa veya geçersizse null döner', () => {
    expect(ageOn(null, on)).toBeNull()
    expect(ageOn('', on)).toBeNull()
    expect(ageOn('abc', on)).toBeNull()
  })
})

describe('priceForAge', () => {
  it('yaşı kapsayan aralığın ücretini, dışındakilere normal ücreti verir', () => {
    expect(priceForAge(threeBed, 0)).toBe(350)
    expect(priceForAge(threeBed, 1)).toBe(350)
    expect(priceForAge(threeBed, 2)).toBe(500)
    expect(priceForAge(threeBed, 6)).toBe(500)
    expect(priceForAge(threeBed, 7)).toBe(900)
    expect(priceForAge(threeBed, 12)).toBe(900)
    expect(priceForAge(threeBed, 13)).toBe(1800)
    expect(priceForAge(threeBed, 45)).toBe(1800)
    expect(priceForAge(threeBed, null)).toBe(1800)
    expect(priceForAge({ pricePerPerson: 1000 }, 3)).toBe(1000)
  })
})

describe('agePriceError', () => {
  it('geçerli aralıkları kabul eder', () => {
    expect(agePriceError(threeBed.childPrices)).toBeNull()
    expect(agePriceError([])).toBeNull()
    expect(agePriceError(null)).toBeNull()
  })

  it('ters, çakışan, eksik ve kesirli aralıkları reddeder', () => {
    expect(agePriceError([{ minAge: 6, maxAge: 2, price: 1 }])).toMatch('büyük')
    expect(
      agePriceError([
        { minAge: 0, maxAge: 2, price: 1 },
        { minAge: 2, maxAge: 6, price: 1 },
      ]),
    ).toMatch('çakışıyor')
    expect(agePriceError([{ minAge: 0, maxAge: 2 }])).toMatch('zorunlu')
    expect(agePriceError([{ minAge: 0.5, maxAge: 2, price: 1 }])).toMatch('tam sayı')
  })
})

describe('isInfant', () => {
  const on = new Date('2026-10-09T12:00:00Z')

  it('0 ve 1 yaşı bebek sayar, 2 yaş ve doğum tarihi olmayanları saymaz', () => {
    expect(isInfant('2026-05-01', on)).toBe(true)
    expect(isInfant('2024-10-10', on)).toBe(true)
    expect(isInfant('2024-10-09', on)).toBe(false)
    expect(isInfant(null, on)).toBe(false)
  })
})

describe('otherPricesForAge / otherPriceError', () => {
  const type = {
    pricePerPerson: 1200,
    childPrices: [{ minAge: 2, maxAge: 6, price: 600 }],
    otherPrices: [{ currency: 'EUR', pricePerPerson: 1100 }],
  }

  it('çocuk ücretine yetişkin ücretlerinin oranını uygular', () => {
    expect(otherPricesForAge(type, 30)).toEqual([{ currency: 'EUR', price: 1100 }])
    expect(otherPricesForAge(type, 4)).toEqual([{ currency: 'EUR', price: 550 }])
    expect(otherPricesForAge({ pricePerPerson: 1000 }, 30)).toEqual([])
  })

  it('ana para birimini ve tekrarı reddeder', () => {
    expect(otherPriceError([{ currency: 'EUR', pricePerPerson: 900 }], 'USD')).toBeNull()
    expect(otherPriceError([{ currency: 'USD', pricePerPerson: 900 }], 'USD')).toMatch(/ana/)
    expect(
      otherPriceError(
        [
          { currency: 'EUR', pricePerPerson: 900 },
          { currency: 'EUR', pricePerPerson: 950 },
        ],
        'USD',
      ),
    ).toMatch(/birden fazla/)
  })
})
