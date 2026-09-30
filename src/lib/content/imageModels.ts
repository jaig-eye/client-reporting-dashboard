// Which OpenAI image models featured images may be generated with.
//
// Shared by three callers that would otherwise each keep their own copy of the list: the Settings
// select, the settings route's validation, and generation itself.
//
// Only models OpenAI still serves belong here. dall-e-3 was removed from the API on 2026-05-12 and
// gpt-image-1 shuts down on 2026-10-23 (https://developers.openai.com/api/docs/deprecations), so a
// list that kept offering them would let someone pick a model that answers every request with an
// error. Descriptions are OpenAI's own, from https://developers.openai.com/api/docs/models.

export const IMAGE_MODELS = {
  'gpt-image-2.5-flare':    { label: 'GPT Image 2.5 Flare — fast, everyday' },
  'gpt-image-2.5-sunburst': { label: 'GPT Image 2.5 Sunburst — OpenAI’s most capable' },
  'gpt-image-2':            { label: 'GPT Image 2 — the previous generation' },
} as const

export type ImageModel = keyof typeof IMAGE_MODELS

/**
 * What NULL, an unrecognised value, and every retired model a row may still hold all mean.
 *
 * The code is the only place the default lives: migration 227 adds the column with no DEFAULT, so
 * moving it is a change here, not a migration and a backfill.
 */
export const DEFAULT_IMAGE_MODEL: ImageModel = 'gpt-image-2.5-flare'

/**
 * The arguments every model above is asked with.
 *
 * One set, because all three accept it (https://developers.openai.com/api/reference/resources/images):
 * 1536x1024 is a standard landscape size for every GPT image model, `medium` is a quality all of
 * them take, and png is what featured images have always been stored as, so what a client's site
 * receives does not change with the model. No `response_format`: GPT image models always answer
 * with base64 and reject the parameter.
 */
export const IMAGE_REQUEST = {
  size:          '1536x1024',
  quality:       'medium',
  output_format: 'png',
} as const

export function isImageModel(v: unknown): v is ImageModel {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(IMAGE_MODELS, v)
}

/**
 * Coerce a stored value to a model that is safe to send to OpenAI.
 *
 * Anything not offered above becomes the default — NULL, a hand-edited typo, and the retired
 * gpt-image-1 and dall-e-3 a row may still hold from before this list changed. That is what keeps
 * generation working on a database without migration 227 and on rows written before a model was
 * retired: they draw with a model that exists instead of failing on one that does not.
 *
 * Case-insensitive, unlike isImageModel: the Settings select and the generator both read through
 * here, so they agree on what will actually run rather than the page showing one model while
 * another is used.
 */
export function resolveImageModel(v: unknown): ImageModel {
  const raw = String(v ?? '').trim().toLowerCase()
  return isImageModel(raw) ? raw : DEFAULT_IMAGE_MODEL
}
