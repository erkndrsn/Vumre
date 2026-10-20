import type { LoginResponse, MeResponse } from '@/types/payload'
import { request } from './client'

const collection = import.meta.env.VITE_PAYLOAD_AUTH_COLLECTION || 'users'
const base = `/${collection}`

export function login(username: string, password: string) {
  return request<LoginResponse>(`${base}/login`, {
    method: 'POST',
    body: { username, password },
    skipUnauthorizedHandler: true,
  })
}

export function logout() {
  return request<{ message: string }>(`${base}/logout`, {
    method: 'POST',
    skipUnauthorizedHandler: true,
  })
}

export function me() {
  return request<MeResponse>(`${base}/me`, { skipUnauthorizedHandler: true })
}

export function refreshToken() {
  return request<{ refreshedToken: string; exp: number; user: MeResponse['user'] }>(
    `${base}/refresh-token`,
    { method: 'POST', skipUnauthorizedHandler: true },
  )
}

export function forgotPassword(username: string) {
  return request<{ message: string }>(`${base}/forgot-password`, {
    method: 'POST',
    body: { username },
    skipUnauthorizedHandler: true,
  })
}

export function resetPassword(token: string, password: string) {
  return request<LoginResponse>(`${base}/reset-password`, {
    method: 'POST',
    body: { token, password },
    skipUnauthorizedHandler: true,
  })
}
