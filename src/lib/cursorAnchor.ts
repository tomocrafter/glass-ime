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
 * brings the same list back while the app still reports the caret at the start
 * of the converted segment, and only a moment later at the end of the text. So
 * when the same list reappears shortly after hiding and the caret moved
 * meanwhile, it stays where it was until the app reports a new position. A
 * different list means a new composition, whose caret is already right.
 */
export class CursorAnchor {
    private visible = false;
    private hiddenAt = 0;
    private lastShown: SpotRect | null = null;
    private lastContent = '';
    /** The stale caret we are ignoring, and the position shown instead. */
    private hold: { stale: SpotRect; shown: SpotRect } | null = null;

    /**
     * The spot to place the candidates at, given the latest one reported.
     * `content` identifies the list shown, to tell a restored list from a new one.
     */
    resolve(spot: SpotRect, visible: boolean, content: string): SpotRect {
        const now = GLib.get_monotonic_time() / 1000;

        if (!visible) {
            if (this.visible) {
                this.hiddenAt = now;
            }
            this.visible = false;
            this.hold = null;

            return spot;
        }

        const restored =
            !this.visible && now - this.hiddenAt < REAPPEAR_MS && content === this.lastContent;
        this.visible = true;
        this.lastContent = content;

        if (restored && this.lastShown && !sameSpot(spot, this.lastShown)) {
            this.hold = { stale: spot, shown: this.lastShown };
        }

        if (this.hold && !sameSpot(spot, this.hold.stale)) {
            this.hold = null;
        }

        this.lastShown = this.hold?.shown ?? spot;

        return this.lastShown;
    }
}
