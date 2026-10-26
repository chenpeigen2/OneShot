import { s, type AuthSpec } from '@oneshot/core'

export const libraryAuth = {
  collection: 'users',
  signup: 'public',
  fields: {
    name: s.text({ max: 50 }),
    phone: s.text({ max: 20 }),
    role: s.select(['reader', 'librarian'], { required: true, default: 'reader' }),
    blocked: s.bool({ default: false }),
    maxBorrow: s.number({ min: 1, max: 20, onlyInt: true, default: 5 }),
    fines: s.number({ min: 0, default: 0 }),
  },
  managed: ['role', 'blocked', 'maxBorrow', 'fines'],
  listRule: '(id = @request.auth.id || @request.auth.role = "librarian") && @request.auth.blocked != true',
  viewRule: '(id = @request.auth.id || @request.auth.role = "librarian") && @request.auth.blocked != true',
} satisfies AuthSpec
