import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type { Rect } from './geometry.js';
import type { SpotRect } from './kimpanel/protocol.js';

const GAP = 6;
const SCREEN_MARGIN = 8;

export interface Placement extends Rect {
    /** Placed above the cursor for lack of room below, so it grows upward. */
    above: boolean;
}

/** Converts the cursor rectangle reported by fcitx5 into stage coordinates. */
export function spotToStageRect(spot: SpotRect): Mtk.Rectangle {
    const rect = new Mtk.Rectangle({
        x: spot.x,
        y: spot.y,
        width: spot.width,
        height: spot.height,
    });
    if (!spot.relative) {
        return rect;
    }

    const windowActor = global.display.focus_window?.get_compositor_private();
    if (!(windowActor instanceof Meta.WindowActor)) {
        return rect;
    }

    const k = shellScale() / spot.scale;

    return new Mtk.Rectangle({
        x: windowActor.x + spot.x * k,
        y: windowActor.y + spot.y * k,
        width: spot.width * k,
        height: spot.height * k,
    });
}

/**
 * Places a popup with its left edge at the cursor, below it or above it when
 * there is no room, keeping it on the cursor's monitor.
 */
export function placeNearCursor(cursor: Mtk.Rectangle, width: number, height: number): Placement {
    const index = global.display.get_monitor_index_for_rect(cursor);
    const monitor = Main.layoutManager.monitors[index] ?? Main.layoutManager.primaryMonitor;

    let x = cursor.x;
    let y = cursor.y + cursor.height + GAP;
    let above = false;

    if (monitor) {
        if (y + height > monitor.y + monitor.height - SCREEN_MARGIN) {
            y = cursor.y - height - GAP;
            above = true;
        }

        const maxX = monitor.x + monitor.width - width - SCREEN_MARGIN;
        x = Math.max(monitor.x + SCREEN_MARGIN, Math.min(x, maxX));
        y = Math.max(monitor.y + SCREEN_MARGIN, y);
    }

    return { x: Math.round(x), y: Math.round(y), width, height, above };
}

function shellScale(): number {
    const stage = global.stage;

    return stage instanceof Clutter.Stage ? St.ThemeContext.get_for_stage(stage).scale_factor : 1;
}
