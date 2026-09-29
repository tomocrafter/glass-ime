import St from 'gi://St';
import Pango from 'gi://Pango';

import type { Rect } from '../geometry.js';
import type { Description } from '../panelState.js';
import { placeBeside } from '../placement.js';
import { setText } from './candidateRow.js';
import { GlassPanel } from './glassPanel.js';

/** The meaning of the selected candidate, shown beside the candidate window. */
export class DescriptionPanel {
    readonly actor = new GlassPanel({ styleClass: 'glass-ime-description', radius: 12 });
    private readonly title = new St.Label({ style_class: 'glass-ime-description-title' });
    private readonly body = new St.Label({ style_class: 'glass-ime-description-body' });

    constructor() {
        this.body.clutter_text.line_wrap = true;
        this.body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.actor.box.add_child(this.title);
        this.actor.box.add_child(this.body);
    }

    show({ title, body }: Description, beside: Rect): void {
        setText(this.title, title);
        setText(this.body, body);
        this.title.visible = title !== '';

        const [width, height] = this.actor.naturalSize;
        this.actor.moveResize(placeBeside(beside, width, height));
        this.actor.popup();
    }

    hide(): void {
        this.actor.popdown();
    }
}
