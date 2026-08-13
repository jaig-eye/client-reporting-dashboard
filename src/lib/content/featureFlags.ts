// Content feature flags.
//
// Non-blog page types (service-area, service pages, regular pages) are sunset from
// the UI for now to keep the content tool focused on blog. The DB columns, check
// constraints, generation routes, and components remain intact and dormant — flip
// this flag back to `true` to re-expose the entry points with no migration needed.
export const SHOW_NON_BLOG_CONTENT_TYPES = false
