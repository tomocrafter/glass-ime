import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type { ImProperty } from '../kimpanel/protocol.js';

export interface StatusButtonActions {
    /** Asks fcitx5 for the input method list, which arrives via {@link StatusButton.setMenu}. */
    requestMenu(): void;
    activate(key: string): void;
    configure(): void;
}

/** The current input mode in the top bar, replacing the fcitx5 tray icon that kimpanel hides. */
export class StatusButton {
    readonly button = new PanelMenu.Button(0.5, 'Glass IME', true);
    private readonly label = new St.Label({
        style_class: 'glass-ime-status',
        y_align: Clutter.ActorAlign.CENTER,
    });
    private readonly inputMethods = new PopupMenu.PopupMenuSection();

    constructor(private readonly actions: StatusButtonActions) {
        const menu = new PopupMenu.PopupMenu(this.button, 0.5, St.Side.TOP);
        menu.addMenuItem(this.inputMethods);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('fcitx5 の設定', () => this.actions.configure());
        menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this.actions.requestMenu();
            }

            return undefined;
        });

        this.button.setMenu(menu);
        this.button.add_child(this.label);
        this.button.hide();
    }

    setLabel(text: string): void {
        this.label.text = text;
        this.button.visible = text !== '';
    }

    setMenu(items: ImProperty[]): void {
        this.inputMethods.removeAll();

        for (const item of items) {
            this.inputMethods.addAction(item.label, () => this.actions.activate(item.key));
        }
    }

    destroy(): void {
        this.button.destroy();
    }
}
