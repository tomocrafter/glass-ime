import {
    CandidateLayout,
    type ImEvent,
    type LookupTable,
    type SpotRect,
    displayLabel,
} from './kimpanel/protocol.js';

export interface Candidate {
    /** Index in the lookup table, as fcitx5 expects it back in SelectCandidate. */
    index: number;
    label: string;
    text: string;
}

/** A dictionary entry mozc attaches to the selected candidate. */
export interface Description {
    title: string;
    body: string;
}

export interface CandidatesView {
    kind: 'candidates';
    preedit: string | null;
    notes: string[];
    candidates: Candidate[];
    description: Description | null;
    cursor: number;
    horizontal: boolean;
}

export type PanelView = { kind: 'hidden' } | { kind: 'indicator'; label: string } | CandidatesView;

const EMPTY_TABLE: LookupTable = {
    labels: [],
    texts: [],
    cursor: -1,
    layout: CandidateLayout.NotSet,
};

const INITIAL_SPOT: SpotRect = { x: 0, y: 0, width: 0, height: 0, relative: false, scale: 1 };

/** Accumulates kimpanel events and decides what the panel should show. */
export class PanelState {
    spot = INITIAL_SPOT;
    imLabel = '';
    private table = EMPTY_TABLE;
    private aux = '';
    private preedit = '';
    private showAux = false;
    private showPreedit = false;
    private showLookupTable = false;

    apply(event: ImEvent): void {
        switch (event.type) {
            case 'aux':
                this.aux = event.text;
                break;
            case 'showAux':
                this.showAux = event.visible;
                break;
            case 'preedit':
                this.preedit = event.text;
                break;
            case 'showPreedit':
                this.showPreedit = event.visible;
                break;
            case 'showLookupTable':
                this.showLookupTable = event.visible;
                break;
            case 'lookupTable':
                this.table = event.table;
                break;
            case 'spot':
                this.spot = event.spot;
                break;
            case 'imProperty':
                this.imLabel = displayLabel(event.property);
                break;
            case 'vanished':
                this.reset();
                break;
        }
    }

    view(): PanelView {
        const aux = this.showAux ? this.aux : '';
        const preedit = this.showPreedit ? this.preedit : '';
        const table = this.showLookupTable ? this.table : EMPTY_TABLE;
        const hasCandidates = table.texts.length > 0;

        // Aux text alone is fcitx5 announcing an input method switch, e.g. "あ (Hiragana)".
        if (aux && !preedit && !hasCandidates) {
            return { kind: 'indicator', label: this.imLabel || aux.replace(/\s*\(.*\)$/, '') };
        }

        if (!preedit && !hasCandidates) {
            return { kind: 'hidden' };
        }

        return {
            kind: 'candidates',
            preedit: preedit || null,
            ...splitNotes(table, aux),
            cursor: table.cursor,
            horizontal: table.layout === CandidateLayout.Horizontal,
        };
    }

    private reset(): void {
        this.spot = INITIAL_SPOT;
        this.imLabel = '';
        this.table = EMPTY_TABLE;
        this.aux = '';
        this.preedit = '';
        this.showAux = false;
        this.showPreedit = false;
        this.showLookupTable = false;
    }
}

/** fcitx5 sends its auxDown text as an unlabeled row among labeled candidates. */
/**
 * fcitx5 sends its auxDown text as an unlabeled row among labeled candidates,
 * and mozc appends a dictionary entry to the selected candidate's text as
 * extra lines: the headword, then its meaning.
 */
function splitNotes(
    table: LookupTable,
    aux: string,
): Pick<CandidatesView, 'notes' | 'candidates' | 'description'> {
    const labeled = table.labels.some((label) => label !== '');
    const notes = aux ? [aux] : [];
    const candidates: Candidate[] = [];
    let description: Description | null = null;

    table.texts.forEach((text, index) => {
        const label = table.labels[index] ?? '';

        if (labeled && label === '') {
            notes.push(text);
            return;
        }

        const [first = '', ...extra] = text.split('\n');
        candidates.push({ index, label: label.replace(/[.:]\s*$/, ''), text: first });

        if (extra.length > 0) {
            description = toDescription(extra);
        }
    });

    return { notes, candidates, description };
}

function toDescription(lines: string[]): Description {
    if (lines.length === 1) {
        return { title: '', body: lines[0] ?? '' };
    }

    const [title = '', ...body] = lines;

    return { title, body: body.join('\n') };
}
