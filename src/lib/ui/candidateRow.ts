import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type { Candidate } from '../panelState.js';

export function setText(label: St.Label, text: string): void {
    if (label.text !== text) {
        label.text = text;
    }
}

/** One reusable candidate row; the panel updates rows in place between keystrokes. */
export class CandidateRow {
    readonly actor = new St.BoxLayout({
        style_class: 'glass-ime-candidate',
        reactive: true,
        track_hover: true,
    });
    private readonly label = new St.Label({
        style_class: 'glass-ime-candidate-label',
        y_align: Clutter.ActorAlign.CENTER,
    });
    private readonly text = new St.Label({
        style_class: 'glass-ime-candidate-text',
        y_align: Clutter.ActorAlign.CENTER,
    });
    private index = -1;

    constructor(onSelect: (index: number) => void) {
        this.actor.add_child(this.label);
        this.actor.add_child(this.text);
        this.actor.connect('button-release-event', () => {
            onSelect(this.index);

            return Clutter.EVENT_STOP;
        });
    }

    /** Distance from the row's left edge to its candidate text. */
    get textOffset(): number {
        const node = this.actor.get_theme_node();
        const padding = node.get_padding(St.Side.LEFT);

        if (!this.label.visible) {
            return padding;
        }

        const [, labelWidth] = this.label.get_preferred_width(-1);

        return padding + labelWidth + node.get_length('spacing');
    }

    update({ index, label, text }: Candidate, selected: boolean): void {
        this.index = index;
        setText(this.label, label);
        setText(this.text, text);
        this.label.visible = label !== '';

        if (selected) {
            this.actor.add_style_class_name('selected');
        } else {
            this.actor.remove_style_class_name('selected');
        }
    }
}
