import type { OneshotConfig } from '../schema.js'
import { writeTsClient } from './ts.js'
import { writeDartClient } from './dart.js'

export async function generateClients(config: OneshotConfig, root: string): Promise<string[]> {
  const dirs: string[] = []
  const clients = config.clients ?? {}
  if (clients.ts) dirs.push(await writeTsClient(config, root, clients.ts.outDir))
  if (clients.dart) dirs.push(await writeDartClient(config, root, clients.dart.outDir))
  return dirs
}

export { writeTsClient, writeDartClient }
