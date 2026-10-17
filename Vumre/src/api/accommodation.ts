import type { BulkRoomsResult, RoomBoard } from '@/types/payload'
import { request } from './client'

export function getRoomBoard() {
  return request<RoomBoard>('/rooms/board')
}

export function bulkCreateRooms(roomType: number, roomNumbers: string[]) {
  return request<BulkRoomsResult>('/rooms/bulk', {
    method: 'POST',
    body: { roomType, roomNumbers },
  })
}

/** `room: null` umrecileri odadan çıkarır. */
export function assignPilgrims(room: number | null, pilgrims: number[]) {
  return request<{ updated: number }>('/pilgrims/assign', {
    method: 'POST',
    body: { room, pilgrims },
  })
}
