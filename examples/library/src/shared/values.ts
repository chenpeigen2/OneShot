import { SidecarActionError } from '@oneshot/core'

export function fail(message: string, status = 400): never {
  throw new SidecarActionError(message, status)
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requiredString(value: unknown, name: string, trim = true): string {
  if (typeof value !== 'string') fail(`${name} 必须为字符串`)
  const result = trim ? value.trim() : value
  if (!result) fail(`${name} 必填`)
  return result
}

export function optionalString(value: unknown, name: string, trim = true): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') fail(`${name} 必须为字符串`)
  return trim ? value.trim() : value
}

export function numberValue(value: unknown, name: string, fallback = 0): number {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(result)) fail(`${name} 必须为有效数字`)
  return result
}

export function integerValue(value: unknown, name: string, fallback: number, min: number, max: number): number {
  const result = numberValue(value, name, fallback)
  if (!Number.isInteger(result) || result < min || result > max) fail(`${name} 需为 ${min}-${max} 的整数`)
  return result
}

export function booleanValue(value: unknown, name: string, fallback?: boolean): boolean {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback
  if (typeof value !== 'boolean') fail(`${name} 需为布尔值`)
  return value
}

export function enumValue<T extends string>(value: unknown, name: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(`${name} 需为 ${values.join('/')}`)
  return value as T
}

export function errorMessage(value: unknown): string | undefined {
  return isObject(value) && typeof value.message === 'string' ? value.message : undefined
}
