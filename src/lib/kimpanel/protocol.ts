// fcitx5 src/ui/kimpanel/kimpanel.cpp

export const IMPANEL_BUS_NAME = 'org.kde.impanel';
export const IMPANEL_OBJECT_PATH = '/org/kde/impanel';
export const INPUT_METHOD_INTERFACE = 'org.kde.kimpanel.inputmethod';
export const IM_PROPERTY_KEY = '/Fcitx/im';

export const IMPANEL_XML = `<node>
<interface name="org.kde.impanel">
  <signal name="SelectCandidate"><arg type="i" name="index"/></signal>
  <signal name="LookupTablePageUp"/>
  <signal name="LookupTablePageDown"/>
  <signal name="TriggerProperty"><arg type="s" name="key"/></signal>
  <signal name="PanelCreated"/>
  <signal name="Configure"/>
</interface>
</node>`;

export const IMPANEL2_XML = `<node>
<interface name="org.kde.impanel2">
  <signal name="PanelCreated2"/>
  <method name="SetSpotRect">
    <arg type="i" name="x" direction="in"/><arg type="i" name="y" direction="in"/>
    <arg type="i" name="w" direction="in"/><arg type="i" name="h" direction="in"/>
  </method>
  <method name="SetRelativeSpotRect">
    <arg type="i" name="x" direction="in"/><arg type="i" name="y" direction="in"/>
    <arg type="i" name="w" direction="in"/><arg type="i" name="h" direction="in"/>
  </method>
  <method name="SetRelativeSpotRectV2">
    <arg type="i" name="x" direction="in"/><arg type="i" name="y" direction="in"/>
    <arg type="i" name="w" direction="in"/><arg type="i" name="h" direction="in"/>
    <arg type="d" name="scale" direction="in"/>
  </method>
  <method name="SetLookupTable">
    <arg type="as" name="label" direction="in"/>
    <arg type="as" name="text" direction="in"/>
    <arg type="as" name="attr" direction="in"/>
    <arg type="b" name="hasPrev" direction="in"/>
    <arg type="b" name="hasNext" direction="in"/>
    <arg type="i" name="cursor" direction="in"/>
    <arg type="i" name="layout" direction="in"/>
  </method>
</interface>
</node>`;

export interface SpotRect {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Relative to the focused window, in the client's scale. */
    relative: boolean;
    scale: number;
}

export enum CandidateLayout {
    NotSet = 0,
    Vertical = 1,
    Horizontal = 2,
}

export interface LookupTable {
    labels: string[];
    texts: string[];
    cursor: number;
    layout: CandidateLayout;
}

export interface ImProperty {
    key: string;
    label: string;
    icon: string;
    text: string;
    shortLabel?: string;
}

export type ImEvent =
    | { type: 'aux'; text: string }
    | { type: 'showAux'; visible: boolean }
    | { type: 'preedit'; text: string }
    | { type: 'showPreedit'; visible: boolean }
    | { type: 'showLookupTable'; visible: boolean }
    | { type: 'lookupTable'; table: LookupTable }
    | { type: 'spot'; spot: SpotRect }
    | { type: 'imProperty'; property: ImProperty }
    | { type: 'menu'; items: ImProperty[] }
    | { type: 'vanished' };

export function toCandidateLayout(value: number): CandidateLayout {
    switch (value) {
        case CandidateLayout.Vertical:
            return CandidateLayout.Vertical;
        case CandidateLayout.Horizontal:
            return CandidateLayout.Horizontal;
        default:
            return CandidateLayout.NotSet;
    }
}

/** Parses "key:label:icon:text:hint,label=short". */
export function parseProperty(raw: string): ImProperty {
    const [key = '', label = '', icon = '', text = '', hint = ''] = raw.split(':');
    const shortLabel = hint
        .split(',')
        .find((h) => h.startsWith('label='))
        ?.slice('label='.length);

    return { key, label, icon, text, shortLabel };
}

/** Keyboard layouts report a language code such as "ja"; show them as "A". */
export function displayLabel(property: ImProperty): string {
    if (property.icon.startsWith('input-keyboard')) {
        return 'A';
    }

    return property.shortLabel || property.label.slice(0, 2);
}
