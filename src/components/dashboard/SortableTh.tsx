'use client'

// A sortable column header. The whole label is a button, so it works from the keyboard, and
// aria-sort tells screen readers which column the table is sorted by and in which direction.

import type { ReactNode } from 'react'
import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react'

export default function SortableTh({
  active, dir, onSort, align = 'right', children,
}: { active: boolean; dir: 'asc' | 'desc'; onSort: () => void; align?: 'left' | 'right'; children: ReactNode }) {
  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`sort-th sort-th--${align}${active ? ' is-sorted' : ''}`}
    >
      <button type="button" className="sort-th__btn" onClick={onSort}>
        <span>{children}</span>
        <span className="sort-th__icon" aria-hidden>
          {active
            ? (dir === 'desc' ? <CaretDown size={10} weight="bold" /> : <CaretUp size={10} weight="bold" />)
            : <CaretUpDown size={10} />}
        </span>
      </button>
    </th>
  )
}
