import { OneShotProvider } from '../api/react'
import { Shell } from './Shell'

const PB = import.meta.env.VITE_PB_URL || ''

export function App() {
  return <OneShotProvider baseUrl={PB}><Shell /></OneShotProvider>
}
