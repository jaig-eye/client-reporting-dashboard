import { redirect } from 'next/navigation'

// Metric mapping was replaced by Campaign Categories
export default function MetricMappingPage() {
  redirect('/admin/categories')
}
