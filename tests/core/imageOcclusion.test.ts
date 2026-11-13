import { describe, expect, it } from 'vitest';
import { renderCloze } from '../../src/core/cloze';
import { occlusionPlan, occlusionScript } from '../../src/core/imageOcclusion';
import vectors from '../fixtures/anki/template-vectors.json';

// Card sides as the real `anki` 26.09.4 package renders them (tests/fixtures/anki/make-template-vectors.py).
const [hideAll, hideOne] = vectors.imageOcclusion.notes;
/** A side of a card of one of the cloze probes, picked by how its text starts. */
const probe = (prefix: string, ord: number, side: 'front' | 'back' = 'front') =>
  (vectors.cloze.find((v) => v.text.startsWith(prefix))!.cards as Record<string, Record<'front' | 'back', string>>)[ord][side];

describe('what an image occlusion card draws', () => {
  it("hides every shape on the question when the note hides all, the card's own in the active color", () => {
    const plan = occlusionPlan(hideAll.cards[0].front);
    expect(plan.draws.map((d) => [d.paint, d.shape.kind])).toEqual([
      ['active', 'rect'], ['active', 'text'], ['inactive', 'ellipse'], ['inactive', 'polygon'],
    ]);
    expect(plan.draws[0].shape).toEqual({ kind: 'rect', left: 0.1, top: 0.1, angle: 0, width: 0.2, height: 0.2, fill: '#ffeba2' });
    expect(plan.draws[1].shape).toEqual({ kind: 'text', left: 0.6, top: 0.7, angle: 0, text: 'Label', scale: 1, fontSize: 0.05, fill: '#000000' });
    expect(plan.draws[3].shape).toEqual({ kind: 'polygon', left: 0.1, top: 0.6, points: [[0.1, 0.6], [0.3, 0.6], [0.2, 0.9]], fill: '#ffeba2' });
    expect(plan.textOnly.map((d) => d.shape.kind)).toEqual(['text']);
    expect(plan.toggle).toBe(true);
  });

  it("outlines the card's shape on the answer and keeps the others hidden", () => {
    const plan = occlusionPlan(hideAll.cards[1].back);
    expect(plan.draws.map((d) => [d.paint, d.shape.kind])).toEqual([
      ['active', 'text'], ['inactive', 'rect'], ['inactive', 'polygon'], ['highlight', 'ellipse'],
    ]);
  });

  it('shows only the shapes being asked about when the note hides one, and no Toggle Masks', () => {
    const front = occlusionPlan(hideOne.cards[1].front);
    expect(front.draws.map((d) => [d.paint, d.shape.kind, 'angle' in d.shape ? d.shape.angle : undefined])).toEqual([
      ['active', 'rect', 45], ['active', 'rect', 0],
    ]);
    expect(front.toggle).toBe(false);
    expect(occlusionPlan(hideOne.cards[1].back).draws.map((d) => d.paint)).toEqual(['highlight', 'highlight']);
    expect(occlusionPlan(hideOne.cards[0].back).draws.map((d) => d.paint)).toEqual(['highlight']);
  });

  it("paints an inactive shape in its own fill, and reads a label's text as the page does", () => {
    const plan = occlusionPlan(probe('{{c1::image-occlusion:polygon', 1));
    expect(plan.draws.map((d) => [d.paint, d.shape.kind, d.fill])).toEqual([
      ['active', 'text', undefined], ['active', 'rect', undefined], ['inactive', 'polygon', undefined], ['inactive', 'rect', '#ff0000'],
    ]);
    expect(plan.draws[0].shape).toMatchObject({ text: 'Label : <b>&"x"</b> \\ é', scale: 1.5, fontSize: 0.04 });
  });

  it('leaves out a shape Anki would draw nothing for: an unknown shape, or a size missing', () => {
    expect(occlusionPlan(probe('{{c1::image-occlusion:rect:left=:', 0)).draws).toEqual([]);
    expect(occlusionPlan('<div class="cloze" data-shape="text" data-text="no scale"></div>').draws).toEqual([]);
    expect(occlusionPlan('<div class="cloze" data-shape="ellipse" data-rx=".1"></div>').draws).toEqual([]);
  });

  it('reads only divs the page shows: not spans, comments, scripts, or an occlusion inside a hidden cloze', () => {
    const rect = 'data-shape="rect" data-width=".1" data-height=".1"';
    const html = `<span class="cloze" ${rect}></span><!-- <div class="cloze" ${rect}></div> --><script>"<div class=\\"cloze\\" ${rect}>"</script>`;
    expect(occlusionPlan(html).draws).toEqual([]);
    // A cloze around an occlusion puts it in data-cloze, encoded, on the question.
    const around = renderCloze(`{{c1::see {{c2::image-occlusion:rect:left=.1:top=.1:width=.1:height=.1:oi=1}}}}`, 1, 'front');
    expect(around).toContain('data-cloze="see&#x20;&lt;div');
    expect(occlusionPlan(around)).toEqual({ draws: [], textOnly: [], toggle: false });
    expect(occlusionPlan(`<DIV CLASS='x cloze' DATA-SHAPE=rect data-width=.5 data-height=".5" data-left=".1" data-left=".9"></DIV>`).draws[0].shape)
      .toMatchObject({ kind: 'rect', left: 0.1, width: 0.5 });
  });
});

/** Anki's stock note type's CSS variables, as getComputedStyle hands them back (with their leading space). */
const STOCK_VARS: Record<string, string> = {
  '--inactive-shape-color': ' #ffeba2', '--active-shape-color': ' #ff8e8e', '--inactive-shape-border': ' 1px #212121',
  '--active-shape-border': ' 1px #212121', '--highlight-shape-color': ' #ff8e8e00', '--highlight-shape-border': ' 1px #ff8e8e',
};

type Fn = (...args: unknown[]) => void;

/** Runs the page's script against a stand-in page, recording what it does to the canvas. */
function page(html: string, { vars = STOCK_VARS, complete = true, image = true, toggle = true } = {}) {
  const calls: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (_, prop: string) => {
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (prop in state) return state[prop];
      return (...args: unknown[]) => calls.push([prop, ...args]);
    },
    set: (_, prop: string, value) => { state[prop] = value; calls.push([`${prop}=`, value]); return true; },
  });
  const listeners = (): Record<string, Fn[]> & { on: Fn; fire: (t: string) => void } => {
    const l: Record<string, Fn[]> = {};
    return Object.assign(l, {
      on: (t: unknown, f: unknown) => { (l[t as string] ??= []).push(f as Fn); },
      fire: (t: string) => { for (const f of l[t] ?? []) f(); },
    });
  };
  const imgEvents = listeners();
  const img = {
    naturalWidth: 400, naturalHeight: 200, complete, addEventListener: imgEvents.on,
    load: () => { img.complete = true; imgEvents.fire('load'); },
  };
  const container = { style: {} as Record<string, string>, innerText: '' };
  const canvas = { clientWidth: 300, clientHeight: 150, width: 0, height: 0, getContext: () => ctx };
  const buttonEvents = listeners();
  const button = { style: {} as Record<string, string>, addEventListener: buttonEvents.on, click: () => buttonEvents.fire('click') };
  const frames: Fn[] = [];
  const winEvents = listeners();
  const win: Record<string, unknown> = {
    devicePixelRatio: 2,
    requestAnimationFrame: (f: Fn) => frames.push(f),
    addEventListener: winEvents.on,
    getComputedStyle: () => ({ getPropertyValue: (n: string) => vars[n] ?? '' }),
  };
  const doc = {
    querySelector: (s: string) => (s === '#image-occlusion-canvas' ? canvas : s === '#image-occlusion-container img' && image ? img : null),
    getElementById: (id: string) => (id === 'image-occlusion-container' ? container : id === 'toggle' && toggle ? button : null),
  };
  new Function('window', 'document', occlusionScript(occlusionPlan(html)))(win, doc);
  const anki = win.anki as { imageOcclusion: { setup: () => void }; setupImageCloze: () => void };
  const flush = () => { while (frames.length) frames.shift()!(); };
  const drawn = () => calls.filter(([name]) => ['fillRect', 'strokeRect', 'ellipse', 'moveTo', 'lineTo', 'translate', 'rotate', 'fillText', 'fillStyle=', 'font=', 'scale'].includes(name as string));
  return { anki, flush, calls, drawn, img, container, canvas, button, resize: () => winEvents.fire('resize') };
}

describe("the page's anki.imageOcclusion.setup()", () => {
  it('sizes the canvas to the image in device pixels and draws each shape scaled to it', () => {
    const p = page(hideAll.cards[0].front);
    p.anki.imageOcclusion.setup();
    p.flush();
    expect(p.container.style.aspectRatio).toBe('2');
    // 300 x 150 points at 2x, for a 400 x 200 image.
    expect([p.canvas.width, p.canvas.height]).toEqual([600, 300]);
    expect(p.drawn()).toEqual([
      ['fillStyle=', '#ff8e8e'], ['fillRect', 60, 30, 120, 60], ['strokeRect', 60, 30, 120, 60],
      ['fillStyle=', '#ff8e8e'], ['font=', '15px Arial'], ['scale', 1, 1], ['fillStyle=', '#ffffff'], ['fillRect', 360, 210, 55, 20], ['fillStyle=', '#000000'], ['fillText', 'Label', 360, 210],
      ['fillStyle=', '#ffeba2'], ['ellipse', 360, 75, 60, 15, 0, 0, Math.PI * 2, false],
      ['fillStyle=', '#ffeba2'], ['translate', 0, 0], ['moveTo', 60, 180], ['lineTo', 60, 180], ['lineTo', 180, 180], ['lineTo', 120, 270],
    ]);
    expect(p.calls.filter(([n]) => n === 'strokeStyle=' || n === 'lineWidth=').slice(0, 2)).toEqual([['strokeStyle=', '#212121'], ['lineWidth=', 1]]);
  });

  it("uses Anki's colors when the note type's CSS has none, and outlines the answer", () => {
    const p = page(hideOne.cards[0].back, { vars: {} });
    p.anki.setupImageCloze();
    p.flush();
    expect(p.calls.filter(([n]) => ['fillStyle=', 'strokeStyle=', 'lineWidth='].includes(n as string))).toEqual([
      ['fillStyle=', '#ff8e8e00'], ['strokeStyle=', '#ff8e8e'], ['lineWidth=', 1],
    ]);
  });

  it('rotates a shape about its corner', () => {
    const p = page(hideOne.cards[1].front);
    p.anki.imageOcclusion.setup();
    p.flush();
    expect(p.drawn().slice(0, 5)).toEqual([
      ['fillStyle=', '#ff8e8e'], ['translate', 300, 150], ['rotate', Math.PI / 4], ['translate', -300, -150], ['fillRect', 300, 150, 120, 60],
    ]);
  });

  it('hides the masks but not the labels with Toggle Masks, and shows them again', () => {
    const p = page(hideAll.cards[0].back);
    p.anki.imageOcclusion.setup();
    p.flush();
    p.calls.length = 0;
    p.button.click();
    expect(p.drawn().filter(([n]) => n === 'fillText' || n === 'ellipse')).toEqual([['fillText', 'Label', 360, 210]]);
    p.calls.length = 0;
    p.button.click();
    expect(p.drawn().filter(([n]) => n === 'ellipse')).toHaveLength(1);
  });

  it('hides Toggle Masks when no shape hides the others', () => {
    const p = page(hideOne.cards[0].back);
    p.anki.imageOcclusion.setup();
    p.flush();
    expect(p.button.style.display).toBe('none');
  });

  it('waits for the image, and draws again on every resize', () => {
    const p = page(hideOne.cards[0].front, { complete: false });
    p.anki.imageOcclusion.setup();
    p.flush();
    expect(p.canvas.width).toBe(0);
    p.img.load();
    p.flush();
    expect(p.canvas.width).toBe(600);
    p.canvas.clientWidth = 150;
    p.canvas.clientHeight = 75;
    p.resize();
    p.flush();
    expect([p.canvas.width, p.canvas.height]).toEqual([300, 150]);
    expect(p.drawn().filter(([n]) => n === 'fillRect').at(-1)).toEqual(['fillRect', 30, 15, 60, 30]);
  });

  it('says so when the note has no image', () => {
    const p = page(hideOne.cards[0].front, { image: false });
    p.anki.imageOcclusion.setup();
    p.flush();
    expect(p.container.innerText).toBe('No image to show.');
  });

  it("can't be ended early by a label's text", () => {
    const script = occlusionScript(occlusionPlan('<div class="cloze" data-shape="text" data-scale="1" data-text="&lt;/script&gt;"></div>'));
    expect(script).not.toContain('</script>');
    expect(script).toContain('\\u003c/script>');
  });
});
