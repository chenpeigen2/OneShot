import { defineConfig, service } from '@oneshot/core'
import { libraryAuth } from './src/config/auth.ts'
import { libraryCollections } from './src/config/collections.ts'

export default defineConfig({
  name: 'library',
  baseUrl: 'http://127.0.0.1:8095',
  sidecarUrl: 'http://127.0.0.1:7865',
  batch: { maxRequests: 60, timeout: 10 },
  auth: libraryAuth,

  services: [
    service('library', {
      title: '图书管理',
      collections: libraryCollections,
      actions: {
        stats: { method: 'GET', rule: 'authenticated', handler: './src/features/catalog.ts#stats' },
        borrow: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/circulation.ts#borrow' },
        returnBook: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/circulation.ts#returnBook' },
        renew: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/circulation.ts#renew' },
        reserve: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/reservations.ts#reserve' },
        cancelReservation: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/reservations.ts#cancelReservation' },
        reportLost: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/circulation.ts#reportLost' },
        setCopyStatus: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/inventory.ts#setCopyStatus' },
        settleFines: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/members.ts#settleFines' },
        addBookWithCopies: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/inventory.ts#addBookWithCopies' },
        addCopies: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/inventory.ts#addCopies' },
        setRole: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/members.ts#setRole' },
        setBanned: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './src/features/members.ts#setBanned' },
      },
      hooks: './src/features/catalog.ts',
    }),
  ],

  clients: { ts: { outDir: './web/src/api' } },
})
