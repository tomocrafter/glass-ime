import GLib from 'gi://GLib';

import type { SpotRect } from './kimpanel/protocol.js';

/** How soon after hiding a reappearing candidate list counts as the same composition. */
const REAPPEAR_MS = 1000;

const sameSpot = (a: SpotRect, b: SpotRect) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Chooses where to anchor the candidate list.
 *
 * Some apps report the caret late. Cancelling a conversion, for example,
 * brings the list back while the app still reports the caret at the start of
 * the converted segment, and only a moment later at the end of the text. So
 * when the list reappears shortly after hiding and the caret moved meanwhile,
 * it stays where it was until the app reports a new position.
 */
export class CursorAnchor {
    private visible = false;
    private hiddenAt = 0;
    private lastShown: SpotRect | null = null;
    /** The stale caret we are ignoring, and the position shown instead. */
    private hold: { stale: SpotRect; shown: SpotRect } | null = null;

    /** The spot to place the candidates at, given the latest one reported. */
    resolve(spot: SpotRect, visible: boolean): SpotRect {
        const now = GLib.get_monotonic_time() / 1000;

        if (!visible) {
            if (this.visible) {
                this.hiddenAt = now;
            }
            this.visible = false;
            this.hold = null;

            return spot;
        }

        const reappearing = !this.visible && now - this.hiddenAt < REAPPEAR_MS;
        this.visible = true;

        if (reappearing && this.lastShown && !sameSpot(spot, this.lastShown)) {
            this.hold = { stale: spot, shown: this.lastShown };
        }

        if (this.hold && !sameSpot(spot, this.hold.stale)) {
            this.hold = null;
        }

        this.lastShown = this.hold?.shown ?? spot;

        return this.lastShown;
    }
}
