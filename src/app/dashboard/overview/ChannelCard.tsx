'use client'

// The client boundary the Overview needs to reuse ChannelSourceCard.
//
// ChannelSourceCard imports the CSR entry of @phosphor-icons/react for its arrows, which
// cannot be evaluated inside a server component — importing it straight into the (server
// rendered) Overview page throws "createContext is not a function". Re-exporting it from a
// 'use client' module puts it on the client side of the boundary, unchanged: same props,
// same markup, no edit to a component other pages are about to share.

export { default } from '@/components/ChannelSourceCard'
