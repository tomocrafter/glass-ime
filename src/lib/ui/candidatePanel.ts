import Clutter from 'gi://Clutter';
import type Mtk from 'gi://Mtk';
import St from 'gi://St';

import type { Candidate, CandidatesView } from '../panelState.js';
import { placeNearCursor } from '../placement.js';
import { GlassPanel } from './glassPanel.js';

export interface CandidatePanelActions {
    select(index: number): void;
    pageUp(): void;
    pageDown(): void;
}

const TEXT_INSET = 34;

export class CandidatePanel {
    readonly actor = new GlassPanel({ styleClass: 'glass-ime-candidates' });

    constructor(private readonly actions: CandidatePanelActions) {
        this.actor.connect('scroll-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            const direction = event.get_scroll_direction();

            if (direction === Clutter.ScrollDirection.UP) {
                this.actions.pageUp();
            } else if (direction === Clutter.ScrollDirection.DOWN) {
                this.actions.pageDown();
            }

            return Clutter.EVENT_STOP;
        });
    }

    show(view: CandidatesView, cursor: Mtk.Rectangle): void {
        this.render(view);

        const [width, height] = this.actor.naturalSize;
        const { x, y } = placeNearCursor(cursor, width, height, TEXT_INSET);

        this.actor.moveResize(x, y, width, height);
        this.actor.popup();
    }

    hide(): void {
        this.actor.popdown();
    }

    private render(view: CandidatesView): void {
        const box = this.actor.box;
        box.destroy_all_children();

        if (view.preedit) {
            box.add_child(new St.Label({ style_class: 'glass-ime-preedit', text: view.preedit }));
        }

        for (const note of view.notes) {
            box.add_child(new St.Label({ style_class: 'glass-ime-note', text: note }));
        }

        const list = new St.BoxLayout({
            style_class: view.horizontal ? 'glass-ime-list horizontal' : 'glass-ime-list',
            vertical: !view.horizontal,
        });

        for (const candidate of view.candidates) {
            list.add_child(this.createRow(candidate, candidate.index === view.cursor));
        }

        box.add_child(list);
    }

    private createRow({ index, label, text }: Candidate, selected: boolean): St.BoxLayout {
        const row = new St.BoxLayout({
            style_class: selected ? 'glass-ime-candidate selected' : 'glass-ime-candidate',
            reactive: true,
            track_hover: true,
        });

        if (label) {
            row.add_child(
                new St.Label({
                    style_class: 'glass-ime-candidate-label',
                    text: label,
                    y_align: Clutter.ActorAlign.CENTER,
                }),
            );
        }

        row.add_child(
            new St.Label({
                style_class: 'glass-ime-candidate-text',
                text,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );

        row.connect('button-release-event', () => {
            this.actions.select(index);

            return Clutter.EVENT_STOP;
        });

        return row;
    }
}
