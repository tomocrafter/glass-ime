import type Cairo from 'cairo';
import Pango from 'gi://Pango';

import type { Rect } from './fakeFcitx.js';
import { createText, drawText, paintPastel, roundedRect } from './painting.js';

const FONT = 'Noto Sans CJK JP 17';
const MARGIN = 60;
const PADDING = 40;
const LINE_SPACING = 1.5;

const OPENING =
    '今日はとても良い天気なので、少し遠くまで散歩に出かけることにしました。\n帰りに新しいカフェに寄って、';
const CLOSING =
    '店内には焼きたてのパンの香りが広がっていて、窓際の席からは公園の木々がよく見えます。季節のケーキとあたたかい飲み物を注文して、しばらく本を読みながらのんびり過ごしました。';

/**
 * A document with an insertion point, standing in for the app being typed
 * into. The preedit is drawn inline and underlined, as real apps do.
 */
export class Editor {
    committed = OPENING;
    preedit = '';
    /** The caret in stage coordinates, updated on every paint. */
    caret: Rect = { x: 0, y: 0, width: 2, height: 24 };

    paint(cr: Cairo.Context, width: number, height: number): void {
        paintPastel(cr, width, height);

        roundedRect(cr, MARGIN, MARGIN - 10, width - 2 * MARGIN, height - 2 * MARGIN + 20, 20);
        cr.setSourceRGBA(1, 1, 1, 0.78);
        cr.fill();

        const textWidth = width - 2 * (MARGIN + PADDING);
        const left = MARGIN + PADDING;
        const top = MARGIN + 30;

        cr.setSourceRGB(0.12, 0.12, 0.16);

        const typing = createText(cr, this.committed + this.preedit, {
            font: FONT,
            width: textWidth,
            lineSpacing: LINE_SPACING,
        });
        typing.set_attributes(this.underlinePreedit());
        drawText(cr, typing, left, top);

        const closing = createText(cr, CLOSING, {
            font: FONT,
            width: textWidth,
            lineSpacing: LINE_SPACING,
        });
        drawText(cr, closing, left, top + 150);

        const [strong] = typing.get_cursor_pos(this.byteLength(this.committed + this.preedit));
        if (!strong) {
            return;
        }

        this.caret = {
            x: left + strong.x / Pango.SCALE,
            y: top + strong.y / Pango.SCALE,
            width: 2,
            height: strong.height / Pango.SCALE,
        };

        cr.rectangle(this.caret.x, this.caret.y + 3, 2, this.caret.height - 6);
        cr.setSourceRGB(0.2, 0.4, 0.95);
        cr.fill();
    }

    private underlinePreedit(): Pango.AttrList {
        const attributes = new Pango.AttrList();

        if (this.preedit) {
            const underline = Pango.attr_underline_new(Pango.Underline.SINGLE);
            underline.start_index = this.byteLength(this.committed);
            underline.end_index = this.byteLength(this.committed + this.preedit);
            attributes.insert(underline);
        }

        return attributes;
    }

    private byteLength(text: string): number {
        return new TextEncoder().encode(text).length;
    }
}
