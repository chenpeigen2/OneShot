import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createBackup,
  deleteBackup,
  downloadBackup,
  fetchBackups,
  fetchCollections,
  fetchManifest,
  fetchMeta,
  fetchRecords,
  fileUrl,
  isAuthed,
  login,
  logout,
  pbUrl,
  restoreBackup,
  saveManifest,
  type MetaRecord,
  type PbCollection,
} from './api'

type View = { kind: 'dashboard' } | { kind: 'records'; collection: PbCollection } | { kind: 'editor'; service: string } | { kind: 'backups' }

const FIELD_KINDS = ['text', 'number', 'bool', 'email', 'url', 'date', 'select', 'json', 'file', 'relation', 'editor', 'geoPoint']
const RULE_KEYS = ['list', 'view', 'create', 'update', 'delete']

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return v.length ? JSON.stringify(v).slice(0, 60) : '—'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60)
  return String(v).slice(0, 60)
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState(() => localStorage.getItem('oneshot_pb_url') ?? 'http://127.0.0.1:8090')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(url, email, password)
      onDone()
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <form onSubmit={submit} className="w-96 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">⚡ OneShot 控制台</h1>
          <p className="mt-1 text-sm text-zinc-400">连接 PocketBase 实例（超管账号）</p>
        </div>
        <label className="block text-sm">
          <span className="text-zinc-400">PocketBase 地址</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-400">邮箱</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-400">密码</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500" />
        </label>
        {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50">
          {busy ? '连接中…' : '连接'}
        </button>
      </form>
    </div>
  )
}

function Dashboard({ meta, collections, report, onOpen, onEdit }: {
  meta: MetaRecord | null
  collections: PbCollection[]
  report: any | null
  onOpen: (c: PbCollection) => void
  onEdit: (service: string) => void
}) {
  const counts = useRecordCounts(collections)
  const userColls = collections.filter((c) => !c.system && c.name !== 'oneshot_meta')
  const snapshot = meta?.snapshot

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-sm font-medium text-zinc-400">发布状态</h2>
        {snapshot ? (
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-2xl font-semibold">{meta!.project}</div>
              <div className="text-xs text-zinc-500">发布于 {new Date(snapshot.publishedAt).toLocaleString()}</div>
            </div>
            <div className="text-sm text-zinc-400">manifest hash <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-amber-400">{snapshot.hash}</code></div>
            <div className="text-sm text-zinc-400">{snapshot.services.length} 个服务</div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">还没有发布记录 —— 在项目目录运行 <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-amber-400">oneshot publish</code></p>
        )}
        {report && (
          <div className="mt-4 rounded-xl bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
            <span className="mr-3 text-amber-400">写回并发布成功</span>
            <span className="mr-3">新增 {report.created.length}</span>
            <span className="mr-3">更新 {report.updated.length}</span>
            <span className="mr-3">不变 {report.unchanged.length}</span>
            {report.pruned.length > 0 && <span className="mr-3">删除 {report.pruned.length}</span>}
            <span className="ml-3 text-zinc-500">hash {report.snapshotHash}</span>
          </div>
        )}
      </section>

      {snapshot && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-zinc-400">服务（编辑会写回 oneshot.config.ts 并立即发布）</h2>
          {snapshot.services.map((svc) => (
            <div key={svc.name} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold">{svc.title || svc.name}</h3>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{svc.name}</span>
                {svc.hasHooks && <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-400">hooks</span>}
                <button onClick={() => onEdit(svc.name)} className="ml-auto rounded-lg border border-amber-600/60 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-950">
                  ✎ 编辑服务
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {svc.collections.map((c) => {
                  const coll = collections.find((x) => x.name === c.name)
                  if (!coll) return null
                  return (
                    <button key={c.name} onClick={() => onOpen(coll)}
                      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-left hover:border-amber-600/60">
                      <div>
                        <div className="font-mono text-sm">{c.name}</div>
                        <div className="mt-0.5 text-xs text-zinc-500">{c.fields.length} 字段 · {coll.type}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold">{counts[c.name] ?? '…'}</div>
                        <div className="text-xs text-zinc-500">记录</div>
                      </div>
                    </button>
                  )
                })}
              </div>
              {svc.actions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {svc.actions.map((a) => (
                    <span key={a.name} className="rounded-lg bg-zinc-800 px-2.5 py-1 font-mono text-xs text-zinc-300">
                      {a.method} {a.route}{a.runtime === 'sidecar' ? ' · Node' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {!snapshot && userColls.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-zinc-400">Collections</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {userColls.map((c) => (
              <button key={c.id} onClick={() => onOpen(c)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-left hover:border-amber-600/60">
                <div className="font-mono text-sm">{c.name}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{counts[c.name] ?? '…'} 条记录 · {c.type}</div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function useRecordCounts(colls: PbCollection[]): Record<string, number | string> {
  const [counts, setCounts] = useState<Record<string, number | string>>({})
  const key = colls.map((c) => c.name).join(',')
  useEffect(() => {
    let alive = true
    void (async () => {
      const entries = await Promise.all(colls.filter((c) => !c.system).map(async (c) => {
        try {
          const res = await fetchRecords(c.name, 1, 1)
          return [c.name, res.totalItems] as const
        } catch {
          return [c.name, '—'] as const
        }
      }))
      if (alive) setCounts(Object.fromEntries(entries))
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return counts
}

function RecordsView({ collection, onBack }: { collection: PbCollection; onBack: () => void }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: any[]; totalItems: number; totalPages: number } | null>(null)
  const [selected, setSelected] = useState<any>(null)
  const [error, setError] = useState('')
  const perPage = 20

  const load = useCallback(() => {
    setError('')
    fetchRecords(collection.name, page, perPage).then(setData).catch((e) => setError(e?.message ?? String(e)))
  }, [collection.name, page])

  useEffect(load, [load])

  const columns = collection.fields.filter((f) => f.type !== 'password').slice(0, 7)

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-amber-600">← 返回</button>
        <h2 className="font-mono text-lg font-semibold">{collection.name}</h2>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">只读</span>
        {data && <span className="text-sm text-zinc-500">{data.totalItems} 条</span>}
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs text-zinc-400">
              {columns.map((f) => <th key={f.name} className="px-4 py-3 font-medium">{f.name}</th>)}
              <th className="px-4 py-3 font-medium">created</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/60">
                {columns.map((f) => (
                  <td key={f.name} className="max-w-48 truncate px-4 py-2.5">
                    {f.type === 'file' && r[f.name]
                      ? <a className="text-amber-400 hover:underline" href={fileUrl(collection.name, r.id, Array.isArray(r[f.name]) ? r[f.name][0] : r[f.name])} target="_blank" onClick={(e) => e.stopPropagation()}>📎 文件</a>
                      : fmt(r[f.name])}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-zinc-500">{fmt(r.created)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-zinc-500">没有记录</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-zinc-700 px-3 py-1 disabled:opacity-40">上一页</button>
          <span className="text-zinc-500">{page} / {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border border-zinc-700 px-3 py-1 disabled:opacity-40">下一页</button>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-10 flex justify-end bg-black/60" onClick={() => setSelected(null)}>
          <div className="h-full w-[480px] overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">记录详情</h3>
              <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-zinc-300">✕</button>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}


const inputCls = 'rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-amber-500'

function BackupsView({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<any[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')

  const load = useCallback(() => {
    setError('')
    fetchBackups().then((r) => setItems(Array.isArray(r) ? r : [])).catch((e) => setError(e?.message ?? String(e)))
  }, [])
  useEffect(load, [load])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn(); load() } catch (err: any) { setError(err?.message ?? String(err)) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-amber-600">← 返回</button>
        <h2 className="text-lg font-semibold">备份</h2>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">PB 原生 backups</span>
      </div>
      <p className="mt-2 text-xs text-zinc-500">恢复会重启 PocketBase（短暂不可用），恢复到更早的备份会丢失其后的数据。</p>

      {error && <p className="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="备份名（字母/数字/下划线，自动补 .zip；留空自动时间戳）" className={`${inputCls} w-72 font-mono`} />
        <button disabled={busy} onClick={() => run(() => createBackup(name.trim() || undefined))} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50">+ 创建备份</button>
      </div>

      <div className="mt-4 space-y-2">
        {items.map((b) => (
          <div key={b.key} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm">
            <span className="font-mono text-amber-400">{b.key}</span>
            <span className="text-zinc-500">{(b.size / 1024).toFixed(1)} KB · {new Date(b.modified).toLocaleString()}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => run(() => downloadBackup(b.key))} className="text-xs text-zinc-400 hover:text-amber-400">下载</button>
              <button disabled={busy} onClick={() => { if (confirm(`确认恢复 ${b.key}？PB 将重启且其后的数据丢失。`)) run(() => restoreBackup(b.key)) }} className="text-xs text-zinc-400 hover:text-amber-400">恢复</button>
              <button disabled={busy} onClick={() => { if (confirm(`确认删除备份 ${b.key}？`)) run(() => deleteBackup(b.key)) }} className="text-xs text-zinc-500 hover:text-red-400">删除</button>
            </div>
          </div>
        ))}
        {items.length === 0 && !error && <p className="mt-6 text-center text-sm text-zinc-500">还没有备份</p>}
      </div>
    </div>
  )
}


function EditorView({ config, serviceName, onBack, onSaved }: {
  config: any
  serviceName: string
  onBack: () => void
  onSaved: (report: any) => void
}) {
  const source = useMemo(
    () => config.services.find((s: any) => s.name === serviceName),
    [config, serviceName],
  )
  const [draft, setDraft] = useState<any>(() => JSON.parse(JSON.stringify(source)))
  const [optionTexts, setOptionTexts] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {}
    for (const [coll, def] of Object.entries(draft.collections ?? {})) {
      for (const [name, spec] of Object.entries((def as any).fields ?? {})) {
        t[`${coll}.${name}`] = JSON.stringify((spec as any).options ?? {})
      }
    }
    return t
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [localReport, setLocalReport] = useState<any>(null)

  const setOptionsText = (key: string, text: string) => setOptionTexts((t) => ({ ...t, [key]: text }))

  const renameField = (coll: string, oldName: string, newName: string) => {
    setDraft((d: any) => {
      const fields: any = {}
      for (const [n, spec] of Object.entries(d.collections[coll].fields)) {
        fields[n === oldName ? newName || n : n] = spec
      }
      return { ...d, collections: { ...d.collections, [coll]: { ...d.collections[coll], fields } } }
    })
    setOptionTexts((t) => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(t)) next[k === `${coll}.${oldName}` ? `${coll}.${newName}` : k] = v
      return next
    })
  }

  const setFieldKind = (coll: string, name: string, kind: string) => {
    setDraft((d: any) => ({
      ...d,
      collections: { ...d.collections, [coll]: { ...d.collections[coll], fields: { ...d.collections[coll].fields, [name]: { ...d.collections[coll].fields[name], kind } } } },
    }))
  }

  const deleteField = (coll: string, name: string) => {
    setDraft((d: any) => {
      const fields = { ...d.collections[coll].fields }
      delete fields[name]
      return { ...d, collections: { ...d.collections, [coll]: { ...d.collections[coll], fields } } }
    })
  }

  const addField = (coll: string) => {
    let n = 'new_field'
    let i = 1
    while (draft.collections[coll].fields[n]) n = `new_field${i++}`
    setDraft((d: any) => ({
      ...d,
      collections: { ...d.collections, [coll]: { ...d.collections[coll], fields: { ...d.collections[coll].fields, [n]: { kind: 'text', options: {} } } } },
    }))
    setOptionTexts((t) => ({ ...t, [`${coll}.${n}`]: '{}' }))
  }

  const setRule = (coll: string, key: string, value: string) => {
    setDraft((d: any) => {
      const rules = { ...(d.collections[coll].rules ?? {}) }
      if (value === '') delete rules[key]
      else rules[key] = value
      return { ...d, collections: { ...d.collections, [coll]: { ...d.collections[coll], rules } } }
    })
  }


  const [newCollName, setNewCollName] = useState('')

  const setAction = (name: string, patch: any) => {
    setDraft((d: any) => ({ ...d, actions: { ...d.actions, [name]: { ...(d.actions?.[name] ?? {}), ...patch } } }))
  }
  const renameAction = (oldName: string, newName: string) => {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(newName) && newName !== '') { setError('action 名需以小写字母开头'); return }
    setDraft((d: any) => {
      const actions: any = {}
      for (const [n, v] of Object.entries(d.actions ?? {})) actions[n === oldName ? (newName || n) : n] = v
      return { ...d, actions }
    })
  }
  const addAction = () => {
    let n = 'newAction'
    let i = 1
    while (draft.actions?.[n]) n = `newAction${i++}`
    setAction(n, { method: 'GET', rule: 'authenticated', runtime: 'jsvm', handler: './hooks/tasks.ts#handler' })
  }
  const deleteAction = (name: string) => {
    setDraft((d: any) => {
      const actions = { ...d.actions }
      delete actions[name]
      return { ...d, actions }
    })
  }

  const addCollection = () => {
    const name = newCollName.trim()
    if (!name) return
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { setError('collection 名需小写字母开头，只含小写字母/数字/下划线'); return }
    if (draft.collections[name]) { setError(`collection 已存在：${name}`); return }
    setError('')
    setDraft((d: any) => ({
      ...d,
      collections: { ...d.collections, [name]: { fields: { title: { kind: 'text', options: {} } }, rules: {} } },
    }))
    setOptionTexts((t) => ({ ...t, [`${name}.title`]: '{}' }))
    setNewCollName('')
  }

  const deleteCollection = (coll: string) => {
    if (Object.keys(draft.collections ?? {}).length <= 1) {
      setError('服务至少要保留一个 collection')
      return
    }
    setError('')
    setDraft((d: any) => {
      const collections = { ...d.collections }
      delete collections[coll]
      return { ...d, collections }
    })
  }

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const next = JSON.parse(JSON.stringify(config))
      const svcDraft = JSON.parse(JSON.stringify(draft))
      for (const [collName, def] of Object.entries(svcDraft.collections ?? {})) {
        const fields: any = {}
        for (const [name, spec] of Object.entries((def as any).fields ?? {})) {
          if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw new Error(`字段名非法（字母开头，只含字母/数字/下划线）：${collName}.${name}`)
          let opts: any
          try {
            opts = JSON.parse(optionTexts[`${collName}.${name}`] ?? '{}')
          } catch {
            throw new Error(`${collName}.${name} 的 options 不是合法 JSON`)
          }
          fields[name] = { kind: (spec as any).kind, options: opts }
        }
        ;(def as any).fields = fields
        if ((def as any).rules && Object.keys((def as any).rules).length === 0) delete (def as any).rules
      }
      next.services = next.services.map((s: any) => (s.name === serviceName ? svcDraft : s))
      const { report } = await saveManifest(next)
      setLocalReport(report)
      onSaved(report)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-amber-600">← 返回</button>
        <h2 className="text-lg font-semibold">编辑服务 <span className="font-mono text-amber-400">{serviceName}</span></h2>
        <button onClick={save} disabled={busy} className="ml-auto rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50">
          {busy ? '写回并发布中…' : '写回 manifest 并发布'}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">保存会写回 oneshot.config.ts（原文件自动备份为 .bak）并立即 diff 式发布；用 git 查看/回滚文件变更。</p>

      {error && <p className="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
      {localReport && !error && (
        <p className="mt-4 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">
          发布完成：新增 {localReport.created.length} · 更新 {localReport.updated.length} · 不变 {localReport.unchanged.length} · hash {localReport.snapshotHash}
        </p>
      )}

      {Object.entries(draft.collections ?? {}).map(([collName, def]: [string, any]) => (
        <section key={collName} className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-center gap-3">
            <h3 className="font-mono text-base font-semibold">{collName}</h3>
            <button
              onClick={() => deleteCollection(collName)}
              title="从 manifest 移除；PB 侧 collection 与数据保留（防误删）"
              className="ml-auto text-xs text-zinc-500 hover:text-red-400"
            >删除 collection</button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="pb-2 pr-3 font-medium">字段名</th>
                  <th className="pb-2 pr-3 font-medium">类型</th>
                  <th className="pb-2 font-medium">options（JSON：required/max/values/collection/default…）</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {Object.entries(def.fields ?? {}).map(([fieldName, spec]: [string, any]) => (
                  <tr key={fieldName} className="align-top">
                    <td className="pb-2 pr-3">
                      <input value={fieldName} onChange={(e) => renameField(collName, fieldName, e.target.value)} className={`${inputCls} w-36 font-mono`} />
                    </td>
                    <td className="pb-2 pr-3">
                      <select value={spec.kind} onChange={(e) => setFieldKind(collName, fieldName, e.target.value)} className={inputCls}>
                        {FIELD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td className="pb-2 w-full">
                      <input value={optionTexts[`${collName}.${fieldName}`] ?? '{}'} onChange={(e) => setOptionsText(`${collName}.${fieldName}`, e.target.value)} className={`${inputCls} w-full font-mono text-xs`} />
                    </td>
                    <td className="pb-2 pl-3">
                      <button
                        onClick={() => deleteField(collName, fieldName)}
                        title="从 manifest 移除；PB 侧字段与数据保留（防误删），彻底删除请到 PB Admin UI"
                        className="text-xs text-zinc-500 hover:text-red-400"
                      >删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => addField(collName)} className="mt-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:border-amber-600">+ 添加字段</button>

          <div className="mt-4 border-t border-zinc-800 pt-4">
            <div className="text-xs text-zinc-500">访问规则（public / authenticated / owner / superuser / 原生 PB filter；留空 = 不声明，默认仅超管）</div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              {RULE_KEYS.map((key) => (
                <label key={key} className="text-xs">
                  <span className="text-zinc-500">{key}</span>
                  <input
                    value={def.rules?.[key] ?? ''}
                    onChange={(e) => setRule(collName, key, e.target.value)}
                    placeholder="留空"
                    className={`${inputCls} mt-1 w-full font-mono text-xs`}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-zinc-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">自定义 actions（handler 文件需已存在；runtime: sidecar 由控制服务器承载）</span>
              <button onClick={() => addAction()} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs hover:border-amber-600">+ 添加 action</button>
            </div>
            <div className="mt-2 space-y-2">
              {Object.entries(draft.actions ?? {}).map(([actionName, a]: [string, any]) => (
                <div key={actionName} className="flex flex-wrap items-center gap-2">
                  <input value={actionName} onChange={(e) => renameAction(actionName, e.target.value)} className={`${inputCls} w-32 font-mono text-xs`} title="action 名" />
                  <select value={a.method ?? 'POST'} onChange={(e) => setAction(actionName, { method: e.target.value })} className={`${inputCls} text-xs`}>
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={a.rule ?? 'authenticated'} onChange={(e) => setAction(actionName, { rule: e.target.value })} className={`${inputCls} text-xs`}>
                    {['public', 'authenticated', 'superuser'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={a.runtime ?? 'jsvm'} onChange={(e) => setAction(actionName, { runtime: e.target.value })} className={`${inputCls} text-xs`}>
                    <option value="jsvm">jsvm</option>
                    <option value="sidecar">sidecar</option>
                  </select>
                  <input value={a.handler ?? ''} onChange={(e) => setAction(actionName, { handler: e.target.value })} placeholder="./hooks/tasks.ts#handler" className={`${inputCls} w-64 font-mono text-xs`} />
                  <button onClick={() => deleteAction(actionName)} className="text-xs text-zinc-500 hover:text-red-400">删除</button>
                </div>
              ))}
              {Object.keys(draft.actions ?? {}).length === 0 && <p className="text-xs text-zinc-600">暂无 action</p>}
            </div>
          </div>

          <div className="mt-4 border-t border-zinc-800 pt-4">
            <label className="text-xs text-zinc-500 block">服务级 hooks 文件（作用于全部 collections；留空 = 无）</label>
            <input value={draft.hooks ?? ''} onChange={(e) => setDraft((d: any) => ({ ...d, hooks: e.target.value || undefined }))} placeholder="./hooks/tasks.ts" className={`${inputCls} mt-1 w-72 font-mono text-xs`} />
          </div>
        </section>
      ))}

      <div className="mt-6 flex items-center gap-2">
        <input
          value={newCollName}
          onChange={(e) => setNewCollName(e.target.value)}
          placeholder="新 collection 名（小写字母开头，如 labels）"
          className={`${inputCls} w-72 font-mono`}
        />
        <button onClick={addCollection} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:border-amber-600">+ 添加 collection</button>
        <span className="text-xs text-zinc-500">保存后随发布在 PB 创建；从 manifest 删除不影响 PB 侧已有数据</span>
      </div>
    </div>
  )
}

export function App() {
  const [authed, setAuthed] = useState(isAuthed)
  const [view, setView] = useState<View>({ kind: 'dashboard' })
  const [collections, setCollections] = useState<PbCollection[]>([])
  const [meta, setMeta] = useState<MetaRecord | null>(null)
  const [manifest, setManifest] = useState<any>(null)
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    setError('')
    fetchCollections().then((r) => setCollections(r.items)).catch((e) => setError(e?.message ?? String(e)))
    fetchMeta().then((r) => setMeta(r.items[0] ?? null)).catch(() => setMeta(null))
    fetchManifest().then((r) => setManifest(r.config)).catch(() => setManifest(null))
  }, [])

  useEffect(() => {
    if (authed) refresh()
  }, [authed, refresh])

  if (!authed) return <LoginScreen onDone={() => setAuthed(true)} />

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-8 py-4">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">⚡ OneShot</span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{pbUrl()}</span>
          <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-400">控制台</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setView({ kind: 'backups' })} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-amber-600">备份</button>
          <button onClick={refresh} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-amber-600">刷新</button>
          <button onClick={() => { logout(); setAuthed(false); setView({ kind: 'dashboard' }) }} className="text-sm text-zinc-500 hover:text-zinc-300">断开</button>
        </div>
      </header>
      {error && <p className="mx-8 mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
      <main className="flex-1 overflow-y-auto">
        {view.kind === 'dashboard' && (
          <Dashboard
            meta={meta}
            collections={collections}
            report={report}
            onOpen={(c) => setView({ kind: 'records', collection: c })}
            onEdit={(service) => setView({ kind: 'editor', service })}
          />
        )}
        {view.kind === 'records' && (
          <RecordsView collection={view.collection} onBack={() => setView({ kind: 'dashboard' })} />
        )}
        {view.kind === 'backups' && <BackupsView onBack={() => setView({ kind: 'dashboard' })} />}
        {view.kind === 'editor' && manifest && (
          <EditorView
            config={manifest}
            serviceName={view.service}
            onBack={() => setView({ kind: 'dashboard' })}
            onSaved={(r) => { setReport(r); setView({ kind: 'dashboard' }); refresh() }}
          />
        )}
        {view.kind === 'editor' && !manifest && (
          <div className="p-8 text-sm text-zinc-500">manifest 不可用（控制服务器未找到 oneshot.config.ts）</div>
        )}
      </main>
    </div>
  )
}
