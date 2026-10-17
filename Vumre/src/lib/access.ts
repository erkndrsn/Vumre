import {
  APIError,
  type Access,
  type FieldAccess,
  type Payload,
  type PayloadRequest,
  type Where,
} from 'payload'

export type Role = 'admin' | 'regionManager'

interface RoleUser {
  id: number | string
  role?: Role | null
  regions?: (number | string | { id: number | string })[] | null
}

const asRoleUser = (user: unknown) => (user ?? null) as RoleUser | null

export const isAdmin = (user: unknown) => asRoleUser(user)?.role === 'admin'

export const isRegionManager = (user: unknown) => asRoleUser(user)?.role === 'regionManager'

/** Bölge yöneticisinin sorumlu olduğu bölgelerin id'leri. */
export function managedRegionIds(user: unknown): (number | string)[] {
  const u = asRoleUser(user)
  if (u?.role !== 'regionManager') return []
  return (u.regions ?? []).map((r) => (typeof r === 'object' ? r.id : r))
}

export const adminOnly: Access = ({ req }) => isAdmin(req.user)

export const adminOnlyField: FieldAccess = ({ req }) => isAdmin(req.user)

/** Okuma herkese (giriş yapmış), yazma yalnızca admine açık. */
export const loggedInReadAdminWrite = {
  read: ({ req }: { req: PayloadRequest }) => !!req.user,
  create: adminOnly,
  update: adminOnly,
  delete: adminOnly,
}

/** Tüm işlemler yalnızca admine açık. */
export const adminOnlyAccess = {
  read: adminOnly,
  create: adminOnly,
  update: adminOnly,
  delete: adminOnly,
}

/**
 * Admin her şeye, bölge yöneticisi yalnızca kendi bölgelerine ait kayıtlara erişir.
 * `field` kaydın bölge alanıdır (umreci için `region`, bölge için `id`).
 */
export const adminOrManagedRegion =
  (field: string): Access =>
  ({ req }) => {
    if (isAdmin(req.user)) return true
    const ids = managedRegionIds(req.user)
    if (!ids.length) return false
    return { [field]: { in: ids } } as Where
  }

/** Özel endpoint'ler (pano, içe/dışa aktarma, kasa, tahsilat) yalnızca admine açık. */
export function requireAdmin(req: PayloadRequest) {
  if (!req.user) throw new APIError('Bu işlem için giriş yapmalısınız.', 401, null, true)
  if (!isAdmin(req.user)) throw new APIError('Bu işlem için yetkiniz yok.', 403, null, true)
}

/** Rol alanından önce oluşturulmuş kullanıcılar admin sayılır. */
export async function backfillUserRoles(payload: Payload) {
  await payload.update({
    collection: 'users',
    where: { role: { exists: false } },
    data: { role: 'admin' },
  })
}
