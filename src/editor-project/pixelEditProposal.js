import { validatePixelEditOperation } from './pixelEditOps.js'

// A model supplies only a proposal, never a path, target identity or permission.
export const PIXEL_PROPOSAL_INSTRUCTIONS = `Return ONLY JSON: "reply" (user's language), "operation" (null or ONE operation). No fences.
You receive metadata, NOT image contents. Never invent objects, masks, colors or coordinates, or claim execution. For discussion, ambiguity, multiple edits or unspecified regions/source colors, use operation:null and answer or clarify. Never expand semantic regions to the whole image.
Exact operation shapes:
{"type":"replace-color","rect":{"x":0,"y":0,"w":1,"h":1},"from":[255,0,0,255],"to":[0,255,0,255]}
{"type":"fill-rect","rect":{"x":0,"y":0,"w":1,"h":1},"color":[0,255,0,255]}
{"type":"erase","rect":{"x":0,"y":0,"w":1,"h":1}}
Other exact fields (all include type and rect): pencil adds points and color; eraser adds points; line/rectangle add start,end,color; flood-fill adds seed,color; text adds at,text,size,color. A point is {"x":1,"y":1}; points is 1..2048 points. One-pixel strokes, hollow rectangle. Points must be user-specified integers inside rect. Flood-fill is four-connected exact RGBA bounded by rect. Text uses local default sans, size 6..96, max 160 characters/4 lines; no font access. Missing coordinates/text require clarification.
Rect: integer pixels from top-left, fully inside supplied dimensions. Whole-image ONLY if explicitly requested. Colors: exact straight-alpha RGBA8 (0..255); hex and standard primary colors allowed, uncertain shades need clarification. Opaque unless specified. Fill replaces; erase zeros RGBA; replace matches all four channels.
App validates and previews; only explicit Apply creates a copy, preserving the original. No tools, paths, credentials, target IDs, scripts or extra fields.`

export function parsePixelEditProposal(text, width, height) {
  try {
    const value = JSON.parse(text)
    if (!value || Array.isArray(value) || Object.keys(value).length !== 2
      || !Object.hasOwn(value, 'reply') || !Object.hasOwn(value, 'operation')
      || typeof value.reply !== 'string' || !value.reply.trim()) throw new Error()
    const operation = value.operation === null ? null
      : validatePixelEditOperation(value.operation, width, height, { x: 0, y: 0, w: width, h: height })
    return { reply: value.reply, operation }
  } catch {
    throw Object.assign(new Error('Invalid pixel proposal; no image was changed.'), { code: 'assistant_response_failed' })
  }
}
