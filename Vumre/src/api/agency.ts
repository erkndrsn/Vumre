import type { AgencyPilgrim } from '@/types/payload'
import { request } from './client'

/** Acentenin gördüğü umreciler: yalnızca ad, soyad, doğum tarihi, uçuş noktası, oda ve kimlik. */
export function listAgencyPilgrims() {
  return request<AgencyPilgrim[]>('/pilgrims/agency')
}
