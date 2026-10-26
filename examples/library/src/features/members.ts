import { defineSidecarAction, withSidecarLocks } from '@oneshot/core'
import { MEMBER_ROLES, decodeList, decodeMember } from '../shared/records'
import { pbGet, q, sysSend } from '../shared/pb'
import { managedMember, requireAuthId, requireLibrarian } from '../shared/queries'
import { booleanValue, enumValue, fail, requiredString } from '../shared/values'

export const settleFines = defineSidecarAction(
  (body) => ({ member: requiredString(body.member, 'member') }),
  async (ctx) => {
    await requireLibrarian(ctx)
    const memberId = ctx.body.member
    return withSidecarLocks(`member:${memberId}`, async () => {
      const member = await managedMember(ctx, memberId)
      const paid = member.fines
      await sysSend(ctx, 'PATCH', `/api/collections/users/records/${memberId}`, { fines: 0 }, decodeMember)
      return { ok: true, member: memberId, paid }
    })
  },
)

export const setRole = defineSidecarAction(
  (body) => ({
    member: requiredString(body.member, 'member'),
    role: enumValue(body.role, 'role', MEMBER_ROLES),
  }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    await requireLibrarian(ctx)
    const { member, role } = ctx.body
    if (member === memberId) fail('不能修改自己的角色')
    const current = await managedMember(ctx, member)
    if (current.role === 'librarian' && role === 'reader') {
      const admins = await pbGet(
        ctx,
        `/api/collections/users/records?filter=${q('role = "librarian" && blocked = false')}&perPage=2`,
        decodeList(decodeMember),
        true,
      )
      if (admins.totalItems <= 1) fail('至少需要保留一名管理员')
    }
    const updated = await sysSend(ctx, 'PATCH', `/api/collections/users/records/${member}`, { role }, decodeMember)
    return { ok: true, member: updated.id, role: updated.role }
  },
)

export const setBanned = defineSidecarAction(
  (body) => ({
    member: requiredString(body.member, 'member'),
    banned: booleanValue(body.banned, 'banned'),
  }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    await requireLibrarian(ctx)
    const { member, banned } = ctx.body
    if (member === memberId) fail('不能封禁自己')
    await managedMember(ctx, member)
    const updated = await sysSend(ctx, 'PATCH', `/api/collections/users/records/${member}`, { blocked: banned }, decodeMember)
    return { ok: true, member: updated.id, blocked: updated.blocked }
  },
)
