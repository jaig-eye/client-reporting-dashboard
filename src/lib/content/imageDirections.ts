// ─────────────────────────────────────────────────────────────────────────────
// Art directions for generated featured images.
//
// The reviewer picks one of these as a pill; each supplies the STYLE half of the prompt.
// Free-text direction is layered on top of it, not instead of it, so "make it feel colder"
// steers a chosen look rather than having to describe a whole look from scratch.
//
// Why a fixed set rather than only free text: the failure mode of an open prompt box is that
// people describe a subject ("a truck in a garage") when the model already knows the subject
// from the post — what it lacks is a treatment. Naming the treatments turns the box into what
// it should be, a modifier, and makes the good ones one click away.
//
// STRUCTURAL POINT, and the bug this fixes: buildPrompt used to hardcode a photojournalism
// block into every prompt INCLUDING the custom-direction branch, so a request for a flat
// vector illustration produced "Candid documentary photograph … Photojournalistic realism …
// subtle natural film grain … flat vector illustration". The model resolved that contradiction
// by ignoring the direction. Each direction therefore owns its own `style` AND its own
// `avoid` list, and the caller substitutes rather than appends.
//
// What every direction shares is `UNIVERSAL_CONSTRAINTS` — no rendered text, no people,
// composition for a headline overlay. Those are product rules, not stylistic preferences, so
// they are not a direction's to override.
// ─────────────────────────────────────────────────────────────────────────────

export type ImageDirectionId =
  | 'documentary'
  | 'editorial'
  | 'product_hero'
  | 'lifestyle'
  | 'flat_vector'
  | 'isometric'
  | 'diagram'
  | 'minimal_abstract'

export interface ImageDirection {
  id:    ImageDirectionId
  label: string
  /** One line for the pill's tooltip — what this looks like, in plain terms. */
  hint:  string
  /** Whether the anti-AI photographic negative list applies. False for illustrated looks. */
  photographic: boolean
  /** The style instruction injected into the prompt. */
  style: string
  /** Direction-specific negatives. */
  avoid: string
}

/**
 * Non-negotiable, applied to every direction.
 *
 * TEXT: image models render text as malformed pseudo-lettering. Any signage, label or UI in
 * frame is a giveaway that the picture is synthetic and cannot be corrected afterwards.
 *
 * PEOPLE: bodies are where the tells are — extra fingers, broken limbs, impossible posture.
 * The subject of these articles is the work and the equipment, so people are almost never
 * necessary; where a scene genuinely requires one, hands and forearms alone carry it.
 */
export const UNIVERSAL_CONSTRAINTS =
  'ABSOLUTELY NO TEXT of any kind anywhere in the image — no words, letters, numbers, captions, labels, signage, packaging text, screens, logos, or watermarks; every surface that would normally carry writing must be blank. ' +
  'NO PEOPLE unless the subject cannot be shown without one — prefer the equipment, materials and workspace by themselves. If a person is unavoidable, show only hands and forearms performing the task, tightly cropped; never a face, never a full body, never a group. ' +
  'Rule-of-thirds composition with generous negative space in the upper third for a headline overlay. Shallow depth of field where the medium allows. 16:9 wide landscape.'

/** The anti-AI negative list. Only meaningful for directions that claim to be photographs. */
const PHOTO_AVOID =
  'Avoid any AI-generated or 3D-rendered look: no glossy plastic or waxy surfaces, no HDR glow or evenly-lit studio lighting, no oversaturated or teal-and-orange grading, no artificial symmetry or perfectly tidy staging, no floating holographic interfaces, glowing icons, lightbulbs, gears or other conceptual metaphors, no fake or exaggerated smiles, no stock-photo posing, no surreal or physically impossible details. ' +
  'Repeating the two hard rules because they are the most common failure: no rendered text or lettering anywhere, and no visible people or faces.'

/** Shared by the illustrated directions, where "looks rendered" is the point. */
const ILLUSTRATION_AVOID =
  'Avoid photographic textures, lens blur and film grain — this is a drawn illustration, not a photograph. No clip-art clichés: no lightbulbs, gears, jigsaw pieces, handshake motifs, rocket ships or upward-trending arrows. No rendered text or lettering anywhere. No human faces.'

export const IMAGE_DIRECTIONS: ImageDirection[] = [
  {
    id: 'documentary', label: 'Documentary', photographic: true,
    hint: 'Candid on-location photo. The safest default for trade and service topics.',
    style:
      'Candid documentary photograph. Photojournalistic realism — an authentic photograph taken on location, shot on a full-frame camera with a 35mm lens, natural available light with soft directional shadows, true-to-life muted color and neutral white balance, subtle natural film grain, real textures and worn, lived-in materials, unstaged with slight natural asymmetry.',
    avoid: PHOTO_AVOID,
  },
  {
    id: 'editorial', label: 'Editorial', photographic: true,
    hint: 'Magazine feature photography — composed and lit, still real.',
    style:
      'Editorial magazine photograph. Deliberately composed and lit like a feature spread, shot on a 50mm lens, controlled directional light with soft falloff, restrained contemporary color grading, clean but not sterile, a considered arrangement that still reads as a real place.',
    avoid: PHOTO_AVOID,
  },
  {
    id: 'product_hero', label: 'Product hero', photographic: true,
    hint: 'One object, isolated and lit. For part, tool or equipment topics.',
    style:
      'Product hero photograph. A single subject isolated against a clean uncluttered backdrop, three-quarter angle, soft even key light with a gentle gradient falloff, crisp focus on the subject with the background falling away, honest materials and real surface wear rather than a rendered finish.',
    avoid: PHOTO_AVOID,
  },
  {
    id: 'lifestyle', label: 'In use', photographic: true,
    hint: 'The thing mid-job, in its real context.',
    style:
      'Photograph of the subject genuinely in use, mid-task, in its working environment. Natural light, slight motion in the scene, tools and materials where they would actually be, the ordinary mess of real work left in frame.',
    avoid: PHOTO_AVOID,
  },
  {
    id: 'flat_vector', label: 'Flat vector', photographic: false,
    hint: 'Modern flat illustration. Good for abstract or process topics.',
    style:
      'Flat vector illustration. Clean geometric shapes, a restrained palette of three or four flat colors with no gradients, bold simple silhouettes, generous negative space, contemporary editorial-illustration style with confident line weights.',
    avoid: ILLUSTRATION_AVOID,
  },
  {
    id: 'isometric', label: 'Isometric', photographic: false,
    hint: 'Technical 3/4 view. Suits systems, layouts and how-it-fits-together.',
    style:
      'Isometric technical illustration. Consistent 30-degree axonometric projection, clean flat fills with subtle tonal shading for depth, precise construction, a limited harmonious palette, the whole subject legible in one view.',
    avoid: ILLUSTRATION_AVOID,
  },
  {
    id: 'diagram', label: 'Explainer', photographic: false,
    hint: 'Schematic cutaway. For how-it-works pieces — no labels, by rule.',
    style:
      'Explanatory schematic illustration. A clean cutaway or cross-section revealing internal structure, simplified linework, flat functional color used to separate components rather than decorate, the logic of the thing made visible.',
    avoid: ILLUSTRATION_AVOID +
      ' Component relationships must be conveyed by shape, color and arrangement alone, since no labels or callouts may appear.',
  },
  {
    id: 'minimal_abstract', label: 'Minimal', photographic: false,
    hint: 'Quiet abstract composition. When a literal picture would be a cliché.',
    style:
      'Minimal abstract composition. A single strong idea expressed through form, texture and negative space, a muted two-tone or tonal palette, calm and confident, closer to a book jacket than an illustration.',
    avoid: ILLUSTRATION_AVOID,
  },
]

export const DEFAULT_DIRECTION: ImageDirectionId = 'documentary'

export function getDirection(id: string | null | undefined): ImageDirection {
  return IMAGE_DIRECTIONS.find(d => d.id === id)
    ?? IMAGE_DIRECTIONS.find(d => d.id === DEFAULT_DIRECTION)!
}
