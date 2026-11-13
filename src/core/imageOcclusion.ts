/**
 * Image occlusion on the review screen, as Anki's reviewer draws it (ts/routes/image-occlusion/
 * review.ts and shapes/ in ankitects/anki, at the sync server's ANKI_VERSION, 26.09.4).
 *
 * The cloze filter leaves one empty div per shape (cloze.ts): class "cloze" for the card's own
 * shapes on the question (and cloze 0's text labels, always), "cloze-highlight" for the card's
 * shapes on the answer, "cloze-inactive" for every other cloze's. Anki's stock template hides
 * them and calls `anki.imageOcclusion.setup()`, which draws on a canvas over the image: the card's
 * shapes in the active color, the others only when the note hides them all ("hide all, guess
 * one", oi=1; "hide one, guess one" leaves them off), and on the answer the card's shapes
 * outlined. Positions and sizes are fractions of the image, so the masks follow it at any size.
 *
 * What to draw is worked out here from the rendered HTML (`occlusionPlan`). The page's script
 * (`occlusionScript`, which `cardDocument` puts in every card page) only scales it to the canvas,
 * reads the colors from the note type's CSS variables, as Anki does, and draws.
 */

/** Anki's own colors and text style (tools/lib.ts, and review.ts's fallbacks when the note type's CSS has no variables). */
export const OCCLUSION_DEFAULTS = {
  mask: '#ffeba2',
  active: '#ff8e8e',
  highlight: '#ff8e8e00',
  border: '#212121',
  highlightBorder: '#ff8e8e',
  textColor: '#000000',
  textBackground: '#ffffff',
  font: 'Arial',
  textPadding: 5,
  fontSize: 40,
  /** Anki's message for a note whose Image field has no image (notetype-error-no-image-to-show). */
  noImage: 'No image to show.',
};

/** A shape as Anki's from-cloze.ts builds it: positions and sizes as fractions of the image, angles in degrees. */
export type OcclusionShape =
  | { kind: 'rect'; left: number; top: number; angle: number; width: number; height: number; fill: string }
  | { kind: 'ellipse'; left: number; top: number; angle: number; rx: number; ry: number; fill: string }
  | { kind: 'polygon'; left: number; top: number; points: [number, number][]; fill: string }
  | { kind: 'text'; left: number; top: number; angle: number; text: string; scale: number; fontSize?: number; fill: string };

/** One shape to draw, and which of the note type's colors paints it ("fill" overrides the inactive color). */
export interface OcclusionDraw {
  shape: OcclusionShape;
  paint: 'active' | 'inactive' | 'highlight';
  fill?: string;
}

export interface OcclusionPlan {
  /** Everything drawn when the page opens, in Anki's order: the card's shapes, the others, the answer's outlines. */
  draws: OcclusionDraw[];
  /** What stays once Toggle Masks hides the masks: the text labels. */
  textOnly: OcclusionDraw[];
  /** Whether Toggle Masks is shown: only when a shape hides the others. */
  toggle: boolean;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** An attribute's value as the DOM reads it: Anki's encode_attribute writes the basic entities and &#xHH;. */
function decodeAttribute(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex: string, dec: string, name: string) => {
    if (!hex && !dec) return ENTITIES[name.toLowerCase()] ?? m;
    const cp = parseInt(hex ?? dec, hex ? 16 : 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

/** Every start tag's name and attributes (names lowercased, the first of a repeated one kept, as an HTML parser does). */
function startTags(html: string): { name: string; attrs: Map<string, string> }[] {
  // What the browser never parses as elements: comments, and the insides of scripts and styles.
  const visible = html.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, '');
  const tags: { name: string; attrs: Map<string, string> }[] = [];
  for (const m of visible.matchAll(/<([a-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of m[2].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = a[1].toLowerCase();
      if (!attrs.has(name)) attrs.set(name, decodeAttribute(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    tags.push({ name: m[1].toLowerCase(), attrs });
  }
  return tags;
}

/** from-cloze.ts's buildShape for left and top: anything that isn't a number is 0. */
function position(value: string | undefined): number {
  return parseFloat(Number.isNaN(Number(value)) ? '.0000' : value!);
}

/** shapes/lib.ts storedToAngle: the angle is stored in ten-thousandths of a turn. */
function angle(value: string | undefined): number {
  const steps = Number(value) % 10000;
  return Number.isNaN(steps) ? 0 : (steps / 10000) * 360;
}

/**
 * extractShapeFromRenderedCloze, from a cloze div's data attributes. Undefined for an unknown
 * shape, and for one with a number missing, which Anki's canvas would draw nothing for (a
 * zero size is left out of the attributes, and parses as NaN).
 */
function shapeOf(attrs: Map<string, string>): OcclusionShape | undefined {
  const data = (name: string) => attrs.get(`data-${name}`);
  const left = position(data('left'));
  const top = position(data('top'));
  const fill = data('fill');
  const numbers = (...xs: number[]) => xs.every((x) => !Number.isNaN(x));
  switch (data('shape')) {
    case 'rect': {
      const width = parseFloat(data('width')!);
      const height = parseFloat(data('height')!);
      return numbers(left, top, width, height) ? { kind: 'rect', left, top, angle: angle(data('angle')), width, height, fill: fill ?? OCCLUSION_DEFAULTS.mask } : undefined;
    }
    case 'ellipse': {
      const rx = parseFloat(data('rx')!);
      const ry = parseFloat(data('ry')!);
      return numbers(left, top, rx, ry) ? { kind: 'ellipse', left, top, angle: angle(data('angle')), rx, ry, fill: fill ?? OCCLUSION_DEFAULTS.mask } : undefined;
    }
    case 'polygon': {
      const raw = data('points');
      if (raw === undefined) return undefined;
      // Each point's coordinates are kept as text by Anki and multiplied as numbers; a missing y is 0.
      const points = (raw === '' ? ['0,0'] : raw.split(' ')).map((p): [number, number] => {
        const [x, y] = p.split(',');
        return [x === undefined ? 0 : Number(x), y === undefined ? 0 : Number(y)];
      });
      return numbers(left, top, ...points.flat()) ? { kind: 'polygon', left, top, points, fill: fill ?? OCCLUSION_DEFAULTS.mask } : undefined;
    }
    case 'text': {
      const scale = parseFloat(data('scale')!);
      const fontSize = data('font-size') ? parseFloat(data('font-size')!) : undefined;
      if (!numbers(left, top, scale)) return undefined;
      return {
        kind: 'text', left, top, angle: angle(data('angle')), text: data('text') ?? '', scale,
        // A font size that's missing, zero or not a number is Anki's default, in canvas pixels.
        ...(fontSize ? { fontSize } : {}),
        fill: fill ?? OCCLUSION_DEFAULTS.textColor,
      };
    }
    default:
      return undefined;
  }
}

/**
 * What a rendered card side draws over its image (review.ts drawShapes): the shapes of the divs
 * with class cloze, those with cloze-inactive that hide the others (data-occludeInactive="1"),
 * in their own fill when they have one, then those with cloze-highlight.
 */
export function occlusionPlan(html: string): OcclusionPlan {
  const tags = startTags(html);
  const shapes = (cls: string) => tags
    .filter((t) => t.name === 'div' && (t.attrs.get('class') ?? '').split(/\s+/).includes(cls))
    .flatMap((t) => {
      const shape = shapeOf(t.attrs);
      return shape ? [{ shape, occludeInactive: t.attrs.get('data-occludeinactive') === '1' }] : [];
    });
  const draws: OcclusionDraw[] = [
    ...shapes('cloze').map(({ shape }) => ({ shape, paint: 'active' as const })),
    ...shapes('cloze-inactive').filter((s) => s.occludeInactive).map(({ shape }) => ({
      shape, paint: 'inactive' as const, ...(shape.fill !== OCCLUSION_DEFAULTS.mask ? { fill: shape.fill } : {}),
    })),
    ...shapes('cloze-highlight').map(({ shape }) => ({ shape, paint: 'highlight' as const })),
  ];
  return {
    draws,
    textOnly: draws.filter((d) => d.shape.kind === 'text'),
    toggle: tags.some((t) => t.attrs.get('data-occludeinactive') === '1'),
  };
}

/**
 * The page's side of image occlusion: `anki.imageOcclusion.setup()` (and Anki's older
 * `anki.setupImageCloze()`), which the stock template's own script calls, so it has to run
 * before the card's HTML. Once the image has loaded it sizes the box to the image's shape and the
 * canvas to the box in device pixels (at most 4096 x 4096, Safari's limit), as review.ts does,
 * then draws `plan`, again on every resize, and wires the Toggle Masks button. Colors come from
 * the note type's CSS variables on the canvas (--active-shape-color, --inactive-shape-border...),
 * else Anki's defaults. Setup's options (Anki's onWillDrawShapes and onDidDrawShapes hooks) are
 * ignored.
 */
export function occlusionScript(plan: OcclusionPlan): string {
  // "<" escaped, so a label reading "</script>" can't end the script early.
  const json = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');
  return `(function () {
var plan = ${json(plan)}, D = ${json(OCCLUSION_DEFAULTS)};
var hide = false, wired = false, resizing = false;
function css(style, name) { return style.getPropertyValue(name).trim(); }
function border(value, color) {
  var parts = value.split(' ').filter(function (x) { return x; });
  var width = parseFloat(parts[0]);
  return { width: isNaN(width) ? 1 : width, color: parts[1] || color };
}
function colors(canvas) {
  var s = window.getComputedStyle(canvas);
  return {
    active: css(s, '--active-shape-color') || D.active,
    inactive: css(s, '--inactive-shape-color') || D.mask,
    highlight: css(s, '--highlight-shape-color') || D.highlight,
    borders: {
      active: border(css(s, '--active-shape-border'), D.border),
      inactive: border(css(s, '--inactive-shape-border'), D.border),
      highlight: border(css(s, '--highlight-shape-border'), D.highlightBorder)
    }
  };
}
function drawText(ctx, s, left, top, h, angle) {
  ctx.font = (s.fontSize ? s.fontSize * h : D.fontSize) + 'px ' + D.font;
  ctx.textBaseline = 'top';
  ctx.scale(s.scale, s.scale);
  var lines = s.text.split('\\n'), m = ctx.measureText('M');
  var lineHeight = 1.5 * (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  var x = left / s.scale, y = top / s.scale, widest = 0;
  lines.forEach(function (l) { widest = Math.max(widest, ctx.measureText(l).width); });
  if (angle) { ctx.translate(x, y); ctx.rotate(angle); ctx.translate(-x, -y); }
  ctx.fillStyle = D.textBackground;
  ctx.fillRect(x, y, widest + D.textPadding, lines.length * lineHeight + D.textPadding);
  ctx.fillStyle = s.fill;
  lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineHeight); });
}
function draw(ctx, w, h, d, c) {
  var s = d.shape, b = c.borders[d.paint];
  var left = Math.round(s.left * w), top = Math.round(s.top * h), angle = (s.angle || 0) * Math.PI / 180;
  ctx.save();
  ctx.fillStyle = d.fill || c[d.paint];
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.width;
  if (s.kind === 'text') {
    drawText(ctx, s, left, top, h, angle);
  } else if (s.kind === 'polygon') {
    var pts = s.points.map(function (p) { return [Math.round(p[0] * w), Math.round(p[1] * h)]; });
    var minX = pts[0][0], minY = pts[0][1];
    pts.forEach(function (p) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); });
    ctx.translate(left - minX, top - minY);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.closePath();
    ctx.fill();
    if (b.width) ctx.stroke();
  } else {
    if (angle) { ctx.translate(left, top); ctx.rotate(angle); ctx.translate(-left, -top); }
    if (s.kind === 'rect') {
      var width = Math.round(s.width * w), height = Math.round(s.height * h);
      ctx.fillRect(left, top, width, height);
      if (b.width) ctx.strokeRect(left, top, width, height);
    } else {
      var rx = Math.round(s.rx * w), ry = Math.round(s.ry * h);
      ctx.beginPath();
      ctx.ellipse(left + rx, top + ry, rx, ry, 0, 0, Math.PI * 2, false);
      ctx.closePath();
      ctx.fill();
      if (b.width) ctx.stroke();
    }
  }
  ctx.restore();
}
function paint(canvas) {
  var ctx = canvas.getContext('2d'), c = colors(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  (hide ? plan.textOnly : plan.draws).forEach(function (d) { draw(ctx, canvas.width, canvas.height, d, c); });
}
function layout() {
  var canvas = document.querySelector('#image-occlusion-canvas');
  if (!canvas) return;
  var container = document.getElementById('image-occlusion-container');
  var image = document.querySelector('#image-occlusion-container img');
  if (!image) { if (container) container.innerText = D.noImage; return; }
  container.style.aspectRatio = String(image.naturalWidth / image.naturalHeight);
  var ratio = window.devicePixelRatio || 1;
  var fit = Math.min(canvas.clientWidth * ratio / image.naturalWidth, canvas.clientHeight * ratio / image.naturalHeight);
  var w = image.naturalWidth * fit, h = image.naturalHeight * fit;
  if (w * h > 4096 * 4096) { var shrink = 4096 / Math.sqrt(w * h); w *= shrink; h *= shrink; }
  canvas.width = Math.floor(w);
  canvas.height = Math.floor(h);
  var button = document.getElementById('toggle');
  if (button && !plan.toggle) button.style.display = 'none';
  else if (button && !wired) {
    wired = true;
    button.addEventListener('click', function () { hide = !hide; paint(canvas); });
  }
  paint(canvas);
}
function setup() {
  var image = document.querySelector('#image-occlusion-container img');
  var go = function () { window.requestAnimationFrame(layout); };
  if (!image || image.complete) go();
  else { image.addEventListener('load', go); image.addEventListener('error', go); }
  if (!resizing) { resizing = true; window.addEventListener('resize', setup); }
}
window.anki = window.anki || {};
window.anki.imageOcclusion = { setup: setup };
window.anki.setupImageCloze = setup;
})();`;
}
