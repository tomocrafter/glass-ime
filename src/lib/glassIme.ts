import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { CursorAnchor } from './cursorAnchor.js';
import { IM_PROPERTY_KEY, type ImEvent } from './kimpanel/protocol.js';
import { KimpanelService } from './kimpanel/service.js';
import { PanelState } from './panelState.js';
import { spotToStageRect } from './placement.js';
import { CandidatePanel } from './ui/candidatePanel.js';
import { ModeIndicator } from './ui/modeIndicator.js';
import { StatusButton } from './ui/statusButton.js';

export default class GlassIme {
    private readonly state = new PanelState();
    private readonly anchor = new CursorAnchor();
    private readonly service: KimpanelService;
    private readonly indicator = new ModeIndicator();
    private readonly candidates = new CandidatePanel({
        select: (index) => this.service.selectCandidate(index),
        pageUp: () => this.service.pageUp(),
        pageDown: () => this.service.pageDown(),
    });
    private readonly status = new StatusButton({
        requestMenu: () => this.service.triggerProperty(IM_PROPERTY_KEY),
        activate: (key) => this.service.triggerProperty(key),
        configure: () => this.service.configure(),
    });
    private laterId = 0;

    constructor(uuid: string) {
        this.candidates.actor.addToShell();
        this.indicator.actor.addToShell();
        Main.panel.addToStatusArea(uuid, this.status.button);

        // Take over from fcitx5's own UI only once ours is ready.
        try {
            this.service = new KimpanelService((event) => this.handle(event));
        } catch (error) {
            this.destroyUi();
            throw error;
        }
    }

    destroy(): void {
        this.service.destroy();
        this.destroyUi();
    }

    private destroyUi(): void {
        if (this.laterId) {
            global.compositor.get_laters().remove(this.laterId);
        }

        this.status.destroy();
        this.candidates.actor.destroy();
        this.indicator.actor.destroy();
    }

    private handle(event: ImEvent): void {
        this.state.apply(event);

        switch (event.type) {
            case 'menu':
                this.status.setMenu(event.items);
                return;
            case 'imProperty':
            case 'vanished':
                this.status.setLabel(this.state.imLabel);
                break;
        }

        this.scheduleRender();
    }

    /** fcitx5 sends several signals per update; render once per frame. */
    private scheduleRender(): void {
        if (this.laterId) {
            return;
        }

        this.laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this.laterId = 0;
            this.render();

            return GLib.SOURCE_REMOVE;
        });
    }

    private render(): void {
        const view = this.state.view();
        const cursor = spotToStageRect(this.state.spot);
        const content =
            view.kind === 'candidates' ? view.candidates.map((c) => c.text).join('\n') : '';
        const anchor = spotToStageRect(
            this.anchor.resolve(this.state.spot, view.kind === 'candidates', content),
        );

        if (view.kind === 'indicator') {
            this.indicator.show(view.label, cursor);
        } else {
            this.indicator.hide();
        }

        if (view.kind === 'candidates') {
            this.candidates.show(view, anchor);
        } else {
            this.candidates.hide();
        }
    }
}
