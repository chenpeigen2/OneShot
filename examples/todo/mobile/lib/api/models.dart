// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

import 'dart:convert';

class UsersRecord {
  final String id;
  final DateTime? created;
  final DateTime? updated;
  final String? email;
  final bool verified;
  final String? name;
  final String? avatar;
  const UsersRecord({required this.id, this.created, this.updated, this.email, this.verified = false, this.name, this.avatar});
  factory UsersRecord.fromJson(Map<String, dynamic> json) => UsersRecord(
    id: json['id'] as String,
    created: json['created'] == null ? null : DateTime.tryParse(json['created'] as String),
    updated: json['updated'] == null ? null : DateTime.tryParse(json['updated'] as String),
    email: json['email'] as String?,
    verified: (json['verified'] as bool?) ?? false,
    name: json['name'] as String?,
    avatar: json['avatar'] as String?,
  );
}

class TasksRecord {
  final String id;
  final DateTime? created;
  final DateTime? updated;
  final String title;
  final bool done;
  final num priority;
  final String? due;
  final List<String> tags;
  final dynamic notes;
  final String? owner;
  const TasksRecord({
    required this.id,
    this.created,
    this.updated,
    required this.title,
    required this.done,
    required this.priority,
    this.due,
    required this.tags,
    this.notes,
    this.owner,
  });
  factory TasksRecord.fromJson(Map<String, dynamic> json) => TasksRecord(
    id: json['id'] as String,
    created: json['created'] == null ? null : DateTime.tryParse(json['created'] as String),
    updated: json['updated'] == null ? null : DateTime.tryParse(json['updated'] as String),
    title: json['title'] as String? ?? '',
    done: (json['done'] as bool?) ?? false,
    priority: (json['priority'] as num?) ?? 0,
    due: json['due'] as String?,
    tags: ((json['tags'] as List?) ?? const []).cast<String>(),
    notes: json['notes'],
    owner: json['owner'] as String?,
  );
  Map<String, dynamic> toJson() => {
    'title': title,
    'done': done,
    'priority': priority,
    'due': due,
    'tags': tags,
    'notes': notes,
    'owner': owner,
  };
  String encodeJson() => jsonEncode(toJson());
}
