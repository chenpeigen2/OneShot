import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FieldSpec, OneshotConfig } from '../schema.js'
import { pascal } from './ts.js'

function dartType(spec: FieldSpec): string {
  switch (spec.kind) {
    case 'text': case 'email': case 'url': case 'editor': return 'String'
    case 'date': return 'String?'
    case 'number': return 'num'
    case 'bool': return 'bool'
    case 'select': return spec.options.multi ? 'List<String>' : 'String?'
    case 'json': return 'dynamic'
    case 'file': return (spec.options.multi || (spec.options.maxSelect ?? 1) > 1) ? 'List<String>' : 'String?'
    case 'relation': return spec.options.multi ? 'List<String>' : 'String?'
    case 'geoPoint': return 'Map<String, dynamic>?'
  }
}

function dartDefault(spec: FieldSpec): string {
  switch (spec.kind) {
    case 'text': case 'email': case 'url': case 'editor': return "''"
    case 'number': return '0'
    case 'bool': return 'false'
    case 'select': return spec.options.multi ? 'const []' : 'null'
    case 'json': return 'null'
    case 'file': return (spec.options.multi || (spec.options.maxSelect ?? 1) > 1) ? 'const []' : 'null'
    case 'relation': return spec.options.multi ? 'const []' : 'null'
    case 'date': return 'null'
    case 'geoPoint': return 'null'
  }
}

function isMulti(spec: FieldSpec): boolean {
  return !!spec.options.multi || (spec.kind === 'file' && (spec.options.maxSelect ?? 1) > 1)
}

/** fromJson 取值表达式 */
function dartFromJson(spec: FieldSpec, key: string): string {
  const t = spec.kind
  if (t === 'text' || t === 'email' || t === 'url' || t === 'editor') {
    return `json['${key}'] as String? ?? ''`
  }
  if (t === 'number') return `(json['${key}'] as num?) ?? 0`
  if (t === 'bool') return `(json['${key}'] as bool?) ?? false`
  if (t === 'date') return `json['${key}'] as String?`
  if (t === 'json') return `json['${key}']`
  if (t === 'select') {
    return isMulti(spec)
      ? `((json['${key}'] as List?) ?? const []).cast<String>()`
      : `json['${key}'] as String?`
  }
  if (t === 'file') {
    return isMulti(spec)
      ? `((json['${key}'] as List?) ?? const []).cast<String>()`
      : `json['${key}'] as String?`
  }
  if (t === 'relation') {
    return isMulti(spec)
      ? `((json['${key}'] as List?) ?? const []).cast<String>()`
      : `json['${key}'] as String?`
  }
  if (t === 'geoPoint') return `json['${key}'] as Map<String, dynamic>?`
  return `json['${key}']`
}

export interface DartGenResult {
  dir: string
  files: { name: string; content: string }[]
}

export function buildDartClient(config: OneshotConfig, outDir: string): DartGenResult {
  const header = '// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen\n'
  const authCollection = config.auth?.collection ?? 'users'

  // ---------- models.dart ----------
  const models: string[] = [header, `import 'dart:convert';`, '']
  const modelClasses: string[] = []

  models.push(`class ${pascal(authCollection)}Record {`)
  models.push(`  final String id;`)
  models.push(`  final DateTime? created;`)
  models.push(`  final DateTime? updated;`)
  models.push(`  final String? email;`)
  models.push(`  final bool verified;`)
  models.push(`  final String? name;`)
  models.push(`  final String? avatar;`)
  const authFields = Object.entries(config.auth?.fields ?? {}).filter(([name]) => name !== 'name' && name !== 'avatar')
  for (const [fieldName, spec] of authFields) models.push(`  final ${dartType(spec)} ${fieldName};`)
  models.push(`  const ${pascal(authCollection)}Record({`)
  models.push('    required this.id, this.created, this.updated, this.email, this.verified = false, this.name, this.avatar,')
  for (const [fieldName, spec] of authFields) {
    const nullable = dartType(spec).endsWith('?') || spec.kind === 'json'
    models.push(nullable ? `    this.${fieldName},` : `    required this.${fieldName},`)
  }
  models.push('  });')
  models.push(`  factory ${pascal(authCollection)}Record.fromJson(Map<String, dynamic> json) => ${pascal(authCollection)}Record(`)
  models.push(`    id: json['id'] as String,`)
  models.push(`    created: json['created'] == null ? null : DateTime.tryParse(json['created'] as String),`)
  models.push(`    updated: json['updated'] == null ? null : DateTime.tryParse(json['updated'] as String),`)
  models.push(`    email: json['email'] as String?,`)
  models.push(`    verified: (json['verified'] as bool?) ?? false,`)
  models.push(`    name: json['name'] as String?,`)
  models.push(`    avatar: json['avatar'] as String?,`)
  for (const [fieldName, spec] of authFields) models.push(`    ${fieldName}: ${dartFromJson(spec, fieldName)},`)
  models.push(`  );`)
  models.push(`}\n`)
  modelClasses.push(pascal(authCollection))

  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      const cls = `${pascal(collName)}Record`
      modelClasses.push(cls)
      models.push(`class ${cls} {`)
      models.push(`  final String id;`)
      models.push(`  final DateTime? created;`)
      models.push(`  final DateTime? updated;`)
      const fieldEntries = Object.entries(def.fields ?? {})
      for (const [fieldName, spec] of fieldEntries) {
        models.push(`  final ${dartType(spec)} ${fieldName};`)
      }
      const ctorParams = [
        '    required this.id,',
        '    this.created,',
        '    this.updated,',
        ...fieldEntries.map(([fieldName, spec]) => {
          const t = dartType(spec)
          const nullable = t.endsWith('?') || spec.kind === 'json'
          return nullable ? `    this.${fieldName},` : `    required this.${fieldName},`
        }),
      ]
      models.push(`  const ${cls}({`)
      models.push(...ctorParams)
      models.push('  });')
      models.push(`  factory ${cls}.fromJson(Map<String, dynamic> json) => ${cls}(`)
      models.push(`    id: json['id'] as String,`)
      models.push(`    created: json['created'] == null ? null : DateTime.tryParse(json['created'] as String),`)
      models.push(`    updated: json['updated'] == null ? null : DateTime.tryParse(json['updated'] as String),`)
      for (const [fieldName, spec] of fieldEntries) {
        models.push(`    ${fieldName}: ${dartFromJson(spec, fieldName)},`)
      }
      models.push('  );')
      // toJson：只写业务字段
      models.push(`  Map<String, dynamic> toJson() => {`)
      for (const [fieldName, spec] of fieldEntries) {
        if (isMulti(spec) || spec.kind === 'json' || spec.kind === 'geoPoint') {
          models.push(`    '${fieldName}': ${fieldName},`)
        } else {
          models.push(`    '${fieldName}': ${fieldName},`)
        }
      }
      models.push('  };')
      models.push(`  String encodeJson() => jsonEncode(toJson());`)
      models.push('}\n')
    }
  }

  // ---------- oneshot_client.dart ----------
  const api: string[] = [header, `import 'package:pocketbase/pocketbase.dart';`, `import 'models.dart';`, '']
  api.push(`/// OneShot 生成客户端 —— 基于 pocketbase Dart SDK`)
  api.push(`class OneShotClient {`)
  api.push(`  final PocketBase pb;`)
  api.push(`  OneShotClient(String baseUrl, {PocketBase? pb}) : pb = pb ?? PocketBase(baseUrl);`)
  api.push(`  ${pascal(authCollection)}Api get ${authCollection} => ${pascal(authCollection)}Api(pb);`)
  for (const svc of config.services) {
    for (const collName of Object.keys(svc.collections)) {
      api.push(`  ${pascal(collName)}Api get ${collName} => ${pascal(collName)}Api(pb);`)
    }
  }
  api.push('}\n')

  // auth api
  api.push(`class ${pascal(authCollection)}Api {`)
  api.push(`  final PocketBase pb;`)
  api.push(`  ${pascal(authCollection)}Api(this.pb);`)
  api.push(`  Future<${pascal(authCollection)}Record> login(String email, String password) async {`)
  api.push(`    final auth = await pb.collection('${authCollection}').authWithPassword(email, password);`)
  api.push(`    return ${pascal(authCollection)}Record.fromJson(auth.record.toJson());`)
  api.push(`  }`)
  api.push(`  ${pascal(authCollection)}Record? get me {`)
  api.push(`    final r = pb.authStore.record;`)
  api.push(`    return r == null ? null : ${pascal(authCollection)}Record.fromJson(r.toJson());`)
  api.push(`  }`)
  api.push(`  Future<${pascal(authCollection)}Record> register(Map<String, dynamic> data) async {`)
  api.push(`    final rec = await pb.collection('${authCollection}').create(body: data);`)
  api.push(`    return ${pascal(authCollection)}Record.fromJson(rec.toJson());`)
  api.push(`  }`)
  api.push(`  void logout() => pb.authStore.clear();`)
  api.push(`}\n`)

  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      const cls = pascal(collName)
      api.push(`class ${cls}Api {`)
      api.push(`  final PocketBase pb;`)
      api.push(`  ${cls}Api(this.pb);`)
      api.push(`  Future<List<${cls}Record>> list({int page = 1, int perPage = 20, String? filter, String? sort}) async {`)
      api.push(`    final res = await pb.collection('${collName}').getList(page: page, perPage: perPage, filter: filter, sort: sort);`)
      api.push(`    return res.items.map((r) => ${cls}Record.fromJson(r.toJson())).toList();`)
      api.push(`  }`)
      api.push(`  Future<${cls}Record> one(String id) async {`)
      api.push(`    final rec = await pb.collection('${collName}').getOne(id);`)
      api.push(`    return ${cls}Record.fromJson(rec.toJson());`)
      api.push(`  }`)
      api.push(`  Future<${cls}Record> create(Map<String, dynamic> data) async {`)
      api.push(`    final rec = await pb.collection('${collName}').create(body: data);`)
      api.push(`    return ${cls}Record.fromJson(rec.toJson());`)
      api.push(`  }`)
      api.push(`  Future<${cls}Record> update(String id, Map<String, dynamic> data) async {`)
      api.push(`    final rec = await pb.collection('${collName}').update(id, body: data);`)
      api.push(`    return ${cls}Record.fromJson(rec.toJson());`)
      api.push(`  }`)
      api.push(`  Future<void> remove(String id) => pb.collection('${collName}').delete(id);`)
      for (const [actionName, action] of Object.entries(svc.actions ?? {})) {
        const method = action.method ?? 'POST'
        const hasBody = method !== 'GET'
        api.push(`  Future<dynamic> ${actionName}(${hasBody ? 'Map<String, dynamic> body = const {}' : ''}) {`)
        api.push(`    return pb.send('/api/oneshot/${svc.name}/${actionName}', method: '${method}'${hasBody ? ', body: body' : ''});`)
        api.push(`  }`)
      }
      api.push(`  /// 订阅 realtime 变更（取消用 pb.collection('${collName}').unsubscribe(topic)）`)
      api.push(`  Future<void> watch(void Function(String action, ${cls}Record? record) onEvent, {String topic = '*'}) {`)
      api.push(`    return pb.collection('${collName}').subscribe(topic, (e) {`)
      api.push(`      onEvent(e.action, e.record == null ? null : ${cls}Record.fromJson(e.record!.toJson()));`)
      api.push(`    });`)
      api.push(`  }`)
      api.push('}\n')
    }
  }

  return {
    dir: outDir,
    files: [
      { name: 'models.dart', content: models.join('\n') },
      { name: 'oneshot_client.dart', content: api.join('\n') },
    ],
  }
}

export async function writeDartClient(config: OneshotConfig, root: string, outDir: string): Promise<string> {
  const abs = resolve(root, outDir)
  const result = buildDartClient(config, abs)
  await mkdir(abs, { recursive: true })
  for (const f of result.files) {
    await writeFile(resolve(abs, f.name), f.content, 'utf8')
  }
  return abs
}
