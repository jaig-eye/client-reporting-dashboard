// Which OpenAI image models featured images may be generated with.
//
// The two models do not take the same arguments, so a model cannot be swapped on its own: each
// carries the size and quality it accepts. gpt-image-1 rejects 'hd' and 1792x1024; dall-e-3
// rejects 'medium' and 1536x1024. Sending the wrong pair is a 400 from OpenAI, not a worse image.
//
// Shared by three callers that would otherwise each keep their own copy of the list: the Settings
// select, the settings route's validation, and generation itself.

// `b64` is whether the model needs to be ASKED for base64.
//
// It matters more than it looks. gpt-image-1 always answers with base64 and rejects
// response_format outright, so the parameter must not be sent. dall-e-3 accepts it and defaults to
// `url` without it — and those URLs are temporary, expiring about an hour after generation. Taking
// that default would upload nothing, store a link to OpenAI, and leave every post that used it with
// a broken featured image by the time anyone reviewed it.
export const IMAGE_MODELS = {
  'gpt-image-1': {
    size: '1536x1024', quality: 'medium', b64: false,
    label: 'gpt-image-1 — newer, follows the prompt more literally',
  },
  'dall-e-3': {
    size: '1792x1024', quality: 'hd', b64: true,
    label: 'DALL·E 3 — more photographic, less literal',
  },
} as const

export type ImageModel = keyof typeof IMAGE_MODELS

/** What shipped before the model was configurable. NULL and anything unrecognised mean this. */
export const DEFAULT_IMAGE_MODEL: ImageModel = 'gpt-image-1'

export function isImageModel(v: unknown): v is ImageModel {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(IMAGE_MODELS, v)
}

/**
 * Coerce a stored value to a model that is safe to send to OpenAI.
 *
 * Case-insensitive, unlike isImageModel: the API refuses anything it does not recognise exactly,
 * so the only way a value like 'DALL-E-3' reaches the column is somebody editing the row by hand.
 * Reading it leniently means the Settings select and the generator agree on what will run — both
 * go through here — rather than the page showing one model while the other is used.
 */
export function resolveImageModel(v: unknown): ImageModel {
  const raw = String(v ?? '').trim().toLowerCase()
  return isImageModel(raw) ? raw : DEFAULT_IMAGE_MODEL
}
