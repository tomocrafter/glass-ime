import type Clutter from 'gi://Clutter';

// @girs/gnome-shell augments '@girs/clutter-14', but the namespace lives in its submodule.
declare module '@girs/clutter-18/clutter-18' {
    namespace Clutter {
        interface EaseParams {
            duration?: number;
            delay?: number;
            mode?: Clutter.AnimationMode;
            onComplete?: () => void;
            onStopped?: (isFinished: boolean) => void;
            [property: string]: unknown;
        }

        interface Actor {
            ease(params: EaseParams): void;
        }
    }
}

declare module '@girs/gnome-shell/ui/popupMenu' {
    namespace PopupMenuBase {
        interface SignalMap {
            'open-state-changed': [open: boolean];
        }
    }
}
