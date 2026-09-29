import Clutter from 'gi://Clutter';
import type Mtk from 'gi://Mtk';
import St from 'gi://St';

import type { CandidatesView } from '../panelState.js';
import { type Placement, placeNearCursor } from '../placement.js';
import { CandidateRow, setText } from './candidateRow.js';
import { GlassPanel } from './glassPanel.js';

export interface CandidatePanelActions {
    select(index: number): void;
    pageUp(): void;
    pageDown(): void;
}

/**
 * The candidate window. fcitx5 re-sends the whole panel on every keystroke and
 * cursor move, so unchanged views are skipped and widgets are reused.
 */
export class CandidatePanel {
    readonly actor = new GlassPanel({ styleClass: 'glass-ime-candidates' });
    private readonly preedit = new St.Label({ style_class: 'glass-ime-preedit' });
    private readonly notes = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL });
    private readonly list = new St.BoxLayout({ style_class: 'glass-ime-list' });
    private readonly rows: CandidateRow[] = [];
    private renderedView = '';
    private size: [number, number] = [0, 0];

    constructor(private readonly actions: CandidatePanelActions) {
        this.actor.box.add_child(this.preedit);
        this.actor.box.add_child(this.notes);
        this.actor.box.add_child(this.list);

        this.actor.box.connect('scroll-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            const direction = event.get_scroll_direction();

            if (direction === Clutter.ScrollDirection.UP) {
                this.actions.pageUp();
            } else if (direction === Clutter.ScrollDirection.DOWN) {
                this.actions.pageDown();
            }

            return Clutter.EVENT_STOP;
        });
    }

    /** Shows the candidates near the cursor and returns where the panel went. */
    show(view: CandidatesView, cursor: Mtk.Rectangle): Placement {
        const key = JSON.stringify(view);

        if (key !== this.renderedView) {
            this.render(view);
            this.renderedView = key;
            this.size = this.actor.naturalSize;
        }

        const [width, height] = this.size;
        const placement = placeNearCursor(cursor, width, height, this.textInset());
        this.actor.moveResize(placement);
        this.actor.popup();

        return placement;
    }

    hide(): void {
        this.actor.popdown();
    }

    /** Distance from the panel's left edge to the first candidate's text. */
    private textInset(): number {
        const padding = this.actor.box.get_theme_node().get_padding(St.Side.LEFT);
        const row = this.rows.find((candidate) => candidate.actor.visible);

        return padding + (row?.textOffset ?? 0);
    }

    private render(view: CandidatesView): void {
        setText(this.preedit, view.preedit ?? '');
        this.preedit.visible = view.preedit !== null;

        this.renderNotes(view.notes);

        this.list.orientation = view.horizontal
            ? Clutter.Orientation.HORIZONTAL
            : Clutter.Orientation.VERTICAL;
        if (view.horizontal) {
            this.list.add_style_class_name('horizontal');
        } else {
            this.list.remove_style_class_name('horizontal');
        }

        while (this.rows.length < view.candidates.length) {
            const row = new CandidateRow((index) => this.actions.select(index));
            this.rows.push(row);
            this.list.add_child(row.actor);
        }

        this.rows.forEach((row, index) => {
            const candidate = view.candidates[index];

            row.actor.visible = candidate !== undefined;
            if (candidate) {
                row.update(candidate, candidate.index === view.cursor);
            }
        });
    }

    private renderNotes(notes: string[]): void {
        while (this.notes.get_n_children() < notes.length) {
            this.notes.add_child(new St.Label({ style_class: 'glass-ime-note' }));
        }

        this.notes.get_children().forEach((child, index) => {
            const note = notes[index];

            child.visible = note !== undefined;
            if (child instanceof St.Label && note !== undefined) {
                setText(child, note);
            }
        });
    }
}
