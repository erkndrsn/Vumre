import type { Payload } from 'payload'

type Currency = 'USD' | 'EUR' | 'SAR' | 'TRY'

/**
 * Testlere döviz başına bir kasa açar (ilk istekte). Tahsilat ve giderler kasasız
 * kaydedilemediği için `pay` yardımcıları bunu kullanır. Kasalar, hareketleri silindikten
 * sonra `cleanup` ile silinir.
 */
export function testCashboxes(payload: () => Payload, suffix: string) {
  const ids = new Map<string, number>()
  return {
    async of(currency: Currency = 'USD') {
      const existing = ids.get(currency)
      if (existing !== undefined) return existing
      const box = await payload().create({
        collection: 'cashboxes',
        data: { name: `Test ${currency} ${suffix}`, currency, kind: 'cash' },
      })
      ids.set(currency, box.id)
      return box.id
    },
    async cleanup() {
      for (const id of ids.values()) {
        await payload()
          .delete({ collection: 'cashboxes', id })
          .catch(() => undefined)
      }
    },
  }
}
