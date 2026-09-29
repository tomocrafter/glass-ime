import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { IM_PROPERTY_KEY, type ImEvent } from './kimpanel/protocol.js';
import { KimpanelService } from './kimpanel/service.js';
import { PanelState } from './panelState.js';
import { spotToStageRect } from './placement.js';
import { CandidatePanel } from './ui/candidatePanel.js';
import { ModeIndicator } from './ui/modeIndicator.js';
import { StatusButton } from './ui/statusButton.js';

export default class GlassIme {
    private readonly state = new PanelState();
    private readonly service = new KimpanelService((event) => this.handle(event));
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
        Main.layoutManager.addTopChrome(this.candidates.actor);
        Main.layoutManager.addTopChrome(this.indicator.actor);
        Main.panel.addToStatusArea(uuid, this.status.button);
    }

    destroy(): void {
        if (this.laterId) {
            global.compositor.get_laters().remove(this.laterId);
        }

        this.service.destroy();
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

        if (view.kind === 'indicator') {
            this.indicator.show(view.label, cursor);
        } else {
            this.indicator.hide();
        }

        if (view.kind === 'candidates') {
            this.candidates.show(view, cursor);
        } else {
            this.candidates.hide();
        }
    }
}
