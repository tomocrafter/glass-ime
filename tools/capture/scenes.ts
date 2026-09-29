import type Cairo from 'cairo';

import { Editor } from './editor.js';
import { FakeFcitx, type Rect } from './fakeFcitx.js';
import { createText, drawText, paintPastel } from './painting.js';
import { Recorder, encodeGif, grab, savePng, sleep } from './recorder.js';
import { Stage } from './stage.js';

export type Scene = (outDir: string) => Promise<void>;

const EDITOR_SIZE: [number, number] = [960, 540];
const SETTLE_MS = 600;
const NOTE = '[Tabキーで選択]';
const CAFE = ['カフェ', 'カフェラテ', 'カフェオレ', 'カフェテリア', 'カフェイン'];
const LATTE = ['カフェラテ', 'カフェラテを', 'カフェラテが'];
const CONVERSION = ['変換', '返還', '偏官', 'へんかん', 'ヘンカン'];

const fcitx = new FakeFcitx();

async function onStage(
    width: number,
    height: number,
    paint: (cr: Cairo.Context, width: number, height: number) => void,
    play: (stage: Stage) => Promise<void>,
): Promise<void> {
    const stage = new Stage(width, height, paint);

    try {
        fcitx.hide();
        await sleep(SETTLE_MS);
        await play(stage);
    } finally {
        fcitx.hide();
        stage.destroy();
        await sleep(SETTLE_MS);
    }
}

function onEditor(play: (stage: Stage, editor: Editor) => Promise<void>): Promise<void> {
    const editor = new Editor();

    return onStage(
        ...EDITOR_SIZE,
        (cr, width, height) => editor.paint(cr, width, height),
        (stage) => play(stage, editor),
    );
}

async function type(
    stage: Stage,
    editor: Editor,
    preedit: string,
    candidates: string[],
): Promise<void> {
    editor.preedit = preedit;
    stage.redraw();
    await sleep(30);

    fcitx.moveCursor(stage.toScreen(editor.caret));
    fcitx.showCandidates(candidates, { note: NOTE });
}

function commit(stage: Stage, editor: Editor): void {
    editor.committed += LATTE[0];
    editor.preedit = '';
    stage.redraw();
    fcitx.hide();
}

function around(stage: Stage, caret: Rect, width: number, height: number): Rect {
    return stage.toScreen({
        x: caret.x - width / 2,
        y: caret.y - height / 3,
        width,
        height,
    });
}

function paintBanner(cr: Cairo.Context, width: number, height: number): void {
    paintPastel(cr, width, height);

    cr.setSourceRGBA(0.1, 0.1, 0.14, 0.92);
    drawText(cr, createText(cr, 'Glass IME', { font: 'Noto Sans CJK JP Bold 50' }), 96, 118);

    cr.setSourceRGBA(0.1, 0.1, 0.14, 0.62);
    drawText(
        cr,
        createText(cr, 'Frosted-glass input panel for fcitx5 on GNOME', {
            font: 'Noto Sans CJK JP 17',
        }),
        100,
        208,
    );

    cr.setSourceRGBA(1, 1, 1, 0.92);
    drawText(cr, createText(cr, 'あ', { font: 'Noto Sans CJK JP Bold 190' }), 800, 20);
}

const banner: Scene = (outDir) =>
    onStage(1280, 400, paintBanner, async (stage) => {
        fcitx.moveCursor(stage.toScreen({ x: 760, y: 70, width: 2, height: 26 }));
        fcitx.showCandidates(CONVERSION, { cursor: 0, note: NOTE });
        await sleep(SETTLE_MS);

        savePng(grab(stage.bounds), `${outDir}/banner.png`);
    });

const candidates: Scene = (outDir) =>
    onEditor(async (stage, editor) => {
        await type(stage, editor, 'かふぇ', CAFE);
        fcitx.showCandidates(CAFE, { cursor: 1 });
        await sleep(SETTLE_MS);

        savePng(grab(stage.bounds), `${outDir}/candidates.png`);
    });

const indicator: Scene = (outDir) =>
    onEditor(async (stage, editor) => {
        fcitx.moveCursor(stage.toScreen(editor.caret));
        fcitx.announceMode('あ');
        await sleep(SETTLE_MS);

        savePng(grab(around(stage, editor.caret, 400, 150)), `${outDir}/indicator.png`);
    });

const demo: Scene = (outDir) =>
    onEditor(async (stage, editor) => {
        const recorder = new Recorder(stage.bounds);
        const steps: [number, () => unknown][] = [
            [600, () => type(stage, editor, 'か', ['か', '課', '家', '化'])],
            [380, () => type(stage, editor, 'かふ', ['カフェ', 'かふ'])],
            [380, () => type(stage, editor, 'かふぇ', CAFE)],
            [380, () => type(stage, editor, 'かふぇら', ['カフェラテ', 'カフェラテアート'])],
            [380, () => type(stage, editor, 'かふぇらて', LATTE)],
            [500, () => fcitx.showCandidates(LATTE, { cursor: 0 })],
            [350, () => fcitx.showCandidates(LATTE, { cursor: 1 })],
            [350, () => fcitx.showCandidates(LATTE, { cursor: 0 })],
            [450, () => commit(stage, editor)],
            [700, () => fcitx.announceMode('A')],
            [900, () => fcitx.hide()],
            [500, () => fcitx.announceMode('あ')],
            [900, () => fcitx.hide()],
            [700, () => undefined],
        ];

        recorder.start();

        for (const [delay, step] of steps) {
            await sleep(delay);
            await step();
        }

        const { frames, fps } = recorder.stop();
        encodeGif(frames, fps, 720, `${outDir}/demo.gif`);
    });

export const SCENES: Record<string, Scene> = { banner, candidates, indicator, demo };
