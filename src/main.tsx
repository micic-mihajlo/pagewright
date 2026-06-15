import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import './index.css'
import App from './App.tsx'

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {convexUrl ? (
      <ConvexProvider client={new ConvexReactClient(convexUrl)}>
        <App />
      </ConvexProvider>
    ) : (
      <main className="missing-config">
        <h1>Missing Convex URL</h1>
        <p>Set <code>VITE_CONVEX_URL</code> in the Vercel or local environment.</p>
      </main>
    )}
  </StrictMode>,
)
