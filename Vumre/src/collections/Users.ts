import { APIError, ValidationError, type CollectionConfig, type Where } from 'payload'

import { isAdmin } from '../lib/access'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'Kullanıcı', plural: 'Kullanıcılar' },
  admin: {
    useAsTitle: 'username',
    group: 'Yönetim',
    defaultColumns: ['username', 'name', 'role', 'regions', 'email'],
  },
  // Giriş kullanıcı adıyla yapılır; e-posta isteğe bağlıdır ve yalnızca şifre sıfırlamada kullanılır.
  auth: {
    loginWithUsername: { allowEmailLogin: false, requireEmail: false, requireUsername: true },
  },
  access: {
    // Yönetim paneline (/admin) yalnızca adminler girer.
    admin: ({ req }) => isAdmin(req.user),
    read: ({ req }) => {
      if (isAdmin(req.user)) return true
      return req.user ? ({ id: { equals: req.user.id } } as Where) : false
    },
    create: ({ req }) => isAdmin(req.user),
    // Herkes kendi şifresini değiştirebilir; rol ve bölgeleri yalnızca admin değiştirir.
    update: ({ req, id }) =>
      isAdmin(req.user) || (!!req.user && String(req.user.id) === String(id)),
    // Admin kendi hesabını silemez; aksi halde panelde admin kalmayabilir.
    delete: ({ req, id }) => isAdmin(req.user) && String(req.user!.id) !== String(id),
  },
  fields: [
    // Kullanıcı adı ve e-posta alanları auth ile otomatik eklenir.
    { name: 'name', label: 'Ad Soyad', type: 'text' },
    {
      name: 'role',
      label: 'Rol',
      type: 'select',
      // Var olan kullanıcılar açılışta admin yapılır (backfillUserRoles); kolon bu yüzden
      // NOT NULL değil.
      defaultValue: 'admin',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Bölge yöneticisi', value: 'regionManager' },
      ],
      access: {
        // Admin kendi rolünü düşüremez.
        update: ({ req, id }) => isAdmin(req.user) && String(req.user!.id) !== String(id),
      },
    },
    {
      name: 'regions',
      label: 'Sorumlu olduğu bölgeler',
      type: 'relationship',
      relationTo: 'regions',
      hasMany: true,
      admin: {
        condition: (data) => data?.role === 'regionManager',
        description:
          'Bölge yöneticisi yalnızca bu bölgelere umreci ekler ve bu bölgelerdekileri düzenler; diğer bölgeleri yalnızca görüntüler.',
      },
      access: { update: ({ req }) => isAdmin(req.user) },
    },
  ],
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (data.role === 'regionManager') {
          if (!data.regions?.length) {
            throw new ValidationError({
              collection: 'users',
              errors: [
                { path: 'regions', message: 'Bölge yöneticisi için en az bir bölge seçin.' },
              ],
            })
          }
        } else if (data.role === 'admin') {
          data.regions = []
        }
        return data
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const target = await req.payload.findByID({ collection: 'users', id, depth: 0, req })
        if (target.role !== 'admin') return
        const { totalDocs } = await req.payload.count({
          collection: 'users',
          where: { role: { equals: 'admin' } },
          req,
        })
        if (totalDocs <= 1) {
          throw new APIError('Son admin hesabı silinemez.', 400, null, true)
        }
      },
    ],
  },
}
