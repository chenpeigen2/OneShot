import { useAuth, useClient, useRecords } from '../../api/react'
import type { UsersRecord } from '../../api/schema'
import { useAction } from '../../shared/actions'
import { decodePaidResult } from '../../shared/decoding'
import { Tag } from '../../shared/ui'
import type { Notify } from '../../shared/types'

export function Members({ notify }: { notify: Notify }) {
  const api = useClient()
  const { user } = useAuth<UsersRecord>()
  const { items: users } = useRecords<UsersRecord>('users', { sort: 'email' }, 1, 200)
  const { busy, run } = useAction(notify)
  return <div className="panel"><div className="panel-heading"><h2>读者与权限</h2><p>角色变更即时生效；系统服务账号不会出现在列表中。</p></div><div className="table-wrap"><table><thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>借阅上限</th><th>欠款</th><th>操作</th></tr></thead><tbody>{users.filter((item) => item.email !== 'oneshot-service@system.local').map((member) => <tr key={member.id}><td>{member.email}{member.id === user?.id && <small>当前账号</small>}</td><td><Tag>{member.role === 'librarian' ? '管理员' : '读者'}</Tag></td><td>{member.blocked ? <Tag tone="danger">已封禁</Tag> : <Tag tone="success">正常</Tag>}</td><td>{member.maxBorrow}</td><td>{member.fines ? `${member.fines} 元` : '—'}</td><td><div className="row-actions">{member.id !== user?.id && <><button className="text-button" disabled={!!busy} onClick={() => void run(`role-${member.id}`, () => api.books.setRole({ member: member.id, role: member.role === 'librarian' ? 'reader' : 'librarian' }), () => '角色已更新')}>{member.role === 'librarian' ? '降为读者' : '设为管理员'}</button><button className="text-button danger-text" disabled={!!busy} onClick={() => { if (confirm(`确认${member.blocked ? '解封' : '封禁'} ${member.email}？`)) void run(`ban-${member.id}`, () => api.books.setBanned({ member: member.id, banned: !member.blocked }), () => '账号状态已更新') }}>{member.blocked ? '解封' : '封禁'}</button></>}{Number(member.fines) > 0 && <button className="text-button" disabled={!!busy} onClick={() => void run(`pay-${member.id}`, () => api.books.settleFines({ member: member.id }), (value) => {
    const settled = decodePaidResult(value)
    return `已收款 ${settled.paid} 元`
  })}>收款清零</button>}</div></td></tr>)}</tbody></table></div></div>
}
