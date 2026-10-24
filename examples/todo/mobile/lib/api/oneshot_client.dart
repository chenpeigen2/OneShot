// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

import 'package:pocketbase/pocketbase.dart';
import 'models.dart';

/// OneShot 生成客户端 —— 基于 pocketbase Dart SDK
class OneShotClient {
  final PocketBase pb;
  OneShotClient(String baseUrl, {PocketBase? pb}) : pb = pb ?? PocketBase(baseUrl);
  UsersApi get users => UsersApi(pb);
  TasksApi get tasks => TasksApi(pb);
}

class UsersApi {
  final PocketBase pb;
  UsersApi(this.pb);
  Future<UsersRecord> login(String email, String password) async {
    final auth = await pb.collection('users').authWithPassword(email, password);
    return UsersRecord.fromJson(auth.record.toJson());
  }
  UsersRecord? get me {
    final r = pb.authStore.record;
    return r == null ? null : UsersRecord.fromJson(r.toJson());
  }
  Future<UsersRecord> register(Map<String, dynamic> data) async {
    final rec = await pb.collection('users').create(body: data);
    return UsersRecord.fromJson(rec.toJson());
  }
  void logout() => pb.authStore.clear();
}

class TasksApi {
  final PocketBase pb;
  TasksApi(this.pb);
  Future<List<TasksRecord>> list({int page = 1, int perPage = 20, String? filter, String? sort}) async {
    final res = await pb.collection('tasks').getList(page: page, perPage: perPage, filter: filter, sort: sort);
    return res.items.map((r) => TasksRecord.fromJson(r.toJson())).toList();
  }
  Future<TasksRecord> one(String id) async {
    final rec = await pb.collection('tasks').getOne(id);
    return TasksRecord.fromJson(rec.toJson());
  }
  Future<TasksRecord> create(Map<String, dynamic> data) async {
    final rec = await pb.collection('tasks').create(body: data);
    return TasksRecord.fromJson(rec.toJson());
  }
  Future<TasksRecord> update(String id, Map<String, dynamic> data) async {
    final rec = await pb.collection('tasks').update(id, body: data);
    return TasksRecord.fromJson(rec.toJson());
  }
  Future<void> remove(String id) => pb.collection('tasks').delete(id);
  Future<dynamic> stats() {
    return pb.send('/api/oneshot/tasks/stats', method: 'GET');
  }
  Future<dynamic> summary() {
    return pb.send('/api/oneshot/tasks/summary', method: 'GET');
  }
  /// 订阅 realtime 变更（取消用 pb.collection('tasks').unsubscribe(topic)）
  Future<void> watch(void Function(String action, TasksRecord? record) onEvent, {String topic = '*'}) {
    return pb.collection('tasks').subscribe(topic, (e) {
      onEvent(e.action, e.record == null ? null : TasksRecord.fromJson(e.record!.toJson()));
    });
  }
}
