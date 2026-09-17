// The client's Google listing, shown the way a searcher sees it.
//
// A checklist tells someone their description is 538 characters. A preview shows them what 538
// characters looks like next to their photos and their hours — and a gap in it reads as a gap
// without anyone having to explain the row. So the panel leads with the listing itself and keeps
// the verdicts beside it, anchored to the thing each one is about.
//
// Deliberately *evocative* of a Google knowledge panel rather than a copy of it: our own type and
// tokens, no Google marks. It is the client's own listing, not Google's interface.

import {
  Star, MapPin, Phone, Globe, Clock, ImageSquare,
  CheckCircle, WarningCircle, XCircle,
} from '@phosphor-icons/react/dist/ssr'
import type { GBPProfile } from '@/lib/connectors/google-business-profile'

/** One setting, and how well it is filled in. */
export interface SetupVerdict {
  label: string
  state: 'done' | 'partial' | 'missing'
  value: string
  note?: string
}

export default function ListingPreview({
  listing, rating, reviews, verdicts,
}: {
  listing: GBPProfile
  rating: number
  reviews: number
  verdicts: SetupVerdict[]
}) {
  const done = verdicts.filter(v => v.state === 'done').length
  const todo = verdicts.filter(v => v.state !== 'done')
  const stars = Math.round(rating)

  return (
    <div className="lp">
      {/* ── The listing as Google shows it ─────────────────────────────── */}
      <div className="lp__panel">
        {listing.photos.length > 0 ? (
          <div className="lp__photos" data-count={Math.min(listing.photos.length, 3)}>
            {listing.photos.slice(0, 3).map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="lp__photo" loading="lazy" data-i={i} />
            ))}
            {listing.photo_count > 3 && (
              <span className="lp__photo-more">+{listing.photo_count - 3}</span>
            )}
          </div>
        ) : (
          <div className="lp__photos lp__photos--none">
            <ImageSquare size={22} weight="duotone" aria-hidden />
            <span>No photos on the listing</span>
          </div>
        )}

        <div className="lp__body">
          <h4 className="lp__name">{listing.title || 'Your business'}</h4>

          <p className="lp__rating">
            {rating > 0 ? (
              <>
                <b>{rating.toFixed(1)}</b>
                <span className="lp__stars" role="img" aria-label={`${rating.toFixed(1)} out of 5`}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <Star key={n} size={12} weight={n <= stars ? 'fill' : 'regular'}
                          className={n <= stars ? 'lp__star lp__star--on' : 'lp__star'} aria-hidden />
                  ))}
                </span>
                <span className="lp__muted">({reviews.toLocaleString()})</span>
              </>
            ) : <span className="lp__muted">No reviews yet</span>}
            {listing.primary_category && <span className="lp__muted"> · {listing.primary_category}</span>}
          </p>

          {listing.description && (
            <p className="lp__desc">{listing.description}</p>
          )}

          <dl className="lp__facts">
            {listing.address.length > 0 && (
              <div className="lp__fact">
                <dt><MapPin size={14} weight="fill" aria-hidden /></dt>
                <dd>{listing.address.join(', ')}</dd>
              </div>
            )}
            {listing.service_areas > 0 && listing.address.length === 0 && (
              <div className="lp__fact">
                <dt><MapPin size={14} weight="fill" aria-hidden /></dt>
                <dd>Serves {listing.service_areas} areas</dd>
              </div>
            )}
            {listing.hours.length > 0 && (
              <div className="lp__fact">
                <dt><Clock size={14} weight="fill" aria-hidden /></dt>
                <dd>
                  <ul className="lp__hours">
                    {listing.hours.map((h, i) => (
                      <li key={`${h.day}-${i}`}><span>{h.day.slice(0, 3)}</span><span>{h.open}–{h.close}</span></li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {listing.phone_number && (
              <div className="lp__fact">
                <dt><Phone size={14} weight="fill" aria-hidden /></dt>
                <dd>{listing.phone_number}</dd>
              </div>
            )}
            {listing.website_url && (
              <div className="lp__fact">
                <dt><Globe size={14} weight="fill" aria-hidden /></dt>
                <dd className="lp__truncate">{listing.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</dd>
              </div>
            )}
          </dl>

          {listing.services.length > 0 && (
            <div className="lp__services">
              <p className="lp__services-head">Services</p>
              <ul className="lp__chips">
                {listing.services.slice(0, 8).map(s => <li key={s}>{s}</li>)}
                {listing.services.length > 8 && (
                  <li className="lp__chip-more">+{listing.services.length - 8} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── What is filled in, and what would move the needle ──────────── */}
      <div className="lp__audit">
        <p className="lp__score">
          <b>{done} of {verdicts.length}</b> as complete as Google allows
        </p>
        <ul className="lp__verdicts">
          {verdicts.map(v => (
            <li key={v.label} className="lp__verdict" data-state={v.state}>
              <span className="lp__verdict-mark" aria-hidden>
                {v.state === 'done'    ? <CheckCircle   size={19} weight="fill" />
                 : v.state === 'partial' ? <WarningCircle size={19} weight="fill" />
                 :                         <XCircle      size={19} weight="fill" />}
              </span>
              <span className="lp__verdict-label">{v.label}</span>
              <span className="lp__verdict-value">{v.value}</span>
              {v.note && <span className="lp__verdict-note">{v.note}</span>}
            </li>
          ))}
        </ul>
        {todo.length > 0 && (
          <p className="lp__next">
            Next: {todo.slice(0, 2).map(v => v.label.toLowerCase()).join(', then ')}.
          </p>
        )}
      </div>
    </div>
  )
}
