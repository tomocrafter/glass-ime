import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Mtk from 'gi://Mtk';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';


// 再読み込みのたびに GType 名が衝突しないようにする
const LOAD_ID = GLib.uuid_string_random().replaceAll('-', '');

// ぼかしの端が透明に滲まないよう、実際の表示領域より広く背景を取り込む量
const BLUR_MARGIN = 48;

// 角丸の切り抜き + 彩度の持ち上げ(背景の色味を少し鮮やかに見せる)
const MASK_SHADER = `
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float radius;
uniform float saturation;

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 c = texture2D(tex, uv);

    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = clamp(mix(vec3(l), c.rgb, saturation), 0.0, c.a);

    vec2 size = vec2(width, height);
    vec2 q = abs(uv * size - size * 0.5) - (size * 0.5 - vec2(radius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float a = clamp(0.5 - d, 0.0, 1.0);

    cogl_color_out = c * a;
}`;

// GJS は整数値の Number を int として渡すため、float uniform には端数を足す
const asFloat = v => v + 1e-4;

const RoundedMaskEffect = GObject.registerClass({GTypeName: `GlassIme_RoundedMaskEffect_${LOAD_ID}`},
class RoundedMaskEffect extends Clutter.ShaderEffect {
    _init(radius, saturation) {
        super._init({shader_type: Clutter.ShaderType.FRAGMENT_SHADER});
        this.set_shader_source(MASK_SHADER);
        this.set_uniform_value('radius', asFloat(radius));
        this.set_uniform_value('saturation', asFloat(saturation));
        this.setSize(1, 1);
    }

    setSize(width, height) {
        this.set_uniform_value('width', asFloat(Math.max(width, 1)));
        this.set_uniform_value('height', asFloat(Math.max(height, 1)));
    }
});

// 子の大きさを親の推奨サイズに影響させないためのレイヤー
const ZeroSizeLayer = GObject.registerClass({GTypeName: `GlassIme_ZeroSizeLayer_${LOAD_ID}`},
class ZeroSizeLayer extends St.Widget {
    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }
});

// 背後のウィンドウを複製してぼかし、角丸に切り抜いたガラス面。
// Shell.BlurEffect の BACKGROUND モードは角丸にできないため、
// 背後の壁紙とウィンドウを個別にクローンし、ACTOR モードでぼかしている。
// (window_group 自体はサイズ 0 なので丸ごとはクローンできない)
const GlassPanel = GObject.registerClass({GTypeName: `GlassIme_GlassPanel_${LOAD_ID}`},
class GlassPanel extends St.Widget {
    _init({styleClass, radius = 14, blurRadius = 40, saturation = 1.35}) {
        super._init({
            style_class: `glass-ime-panel ${styleClass}`,
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            opacity: 0,
            reactive: true,
        });
        this._shown = false;
        this._hideTimeoutId = 0;

        this._shadow = new St.Widget({
            style_class: 'glass-ime-shadow',
            style: `border-radius: ${radius}px;`,
            x_expand: true,
            y_expand: true,
        });

        this._glass = new ZeroSizeLayer({x_expand: true, y_expand: true, clip_to_allocation: true});
        this._blurHost = new St.Widget({clip_to_allocation: true});
        this._sources = new Clutter.Actor();
        this._blurHost.add_child(this._sources);
        this._blurHost.add_effect(new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: blurRadius,
            brightness: 1.0,
        }));
        this._glass.add_child(this._blurHost);
        this._mask = new RoundedMaskEffect(radius, saturation);
        this._glass.add_effect(this._mask);

        // 色と縁だけを持つ板。パネルの大きさ(アニメーション中の値)に追従する
        this._surface = new St.Widget({
            style_class: 'glass-ime-surface',
            style: `border-radius: ${radius}px;`,
            x_expand: true,
            y_expand: true,
        });

        // 中身は常に本来の大きさで描き、伸縮中にはみ出す分だけ切り抜く。
        // BinLayout だと伸縮中の狭い幅に押し込まれて文字が省略されるので固定配置にする
        const clip = new ZeroSizeLayer({
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });
        this.box = new St.BoxLayout({
            style_class: 'glass-ime-content',
            vertical: true,
        });
        clip.add_child(this.box);

        this.add_child(this._shadow);
        this.add_child(this._glass);
        this.add_child(this._surface);
        this.add_child(clip);

        this._glass.connect('notify::size', () => this._syncGlass());
        this.connect('notify::position', () => this._syncSourcesPosition());
    }

    _syncGlass() {
        const [width, height] = this._glass.get_size();
        this._blurHost.set_position(-BLUR_MARGIN, -BLUR_MARGIN);
        this._blurHost.set_size(width + 2 * BLUR_MARGIN, height + 2 * BLUR_MARGIN);
        this._mask.setSize(width, height);
    }

    _syncSourcesPosition() {
        // uiGroup はステージ原点にあるので、自身の x/y がそのままステージ座標
        this._sources.set_position(BLUR_MARGIN - this.x, BLUR_MARGIN - this.y);
    }

    // area(ステージ座標)に重なる壁紙とウィンドウだけを、重なり順どおりにクローンする
    _rebuildSources(area) {
        this._sources.destroy_all_children();
        const overlaps = a => a.x < area.x2 && a.x + a.width > area.x1 &&
            a.y < area.y2 && a.y + a.height > area.y1;

        const backgrounds = Main.layoutManager._backgroundGroup?.get_children() ?? [];
        const windows = global.get_window_actors()
            .filter(a => a.visible && !a.meta_window?.minimized);
        for (const source of [...backgrounds, ...windows]) {
            if (!overlaps(source))
                continue;
            const clone = new Clutter.Clone({source});
            clone.set_position(source.x, source.y);
            clone.set_size(source.width, source.height);
            this._sources.add_child(clone);
        }
    }

    get naturalSize() {
        // moveResize で固定したサイズを外してから本来の大きさを測る
        this.box.set_size(-1, -1);
        const [, , width, height] = this.box.get_preferred_size();
        return [Math.ceil(width), Math.ceil(height)];
    }

    // 幅は即座に合わせ、高さ(と上に出す場合の y)だけ滑らかに伸縮させる
    moveResize(x, y, width, height) {
        const animate = this._shown && this.visible;
        this.box.set_size(width, height);
        this._rebuildSources({
            x1: x - BLUR_MARGIN,
            y1: Math.min(y, animate ? this.y : y) - BLUR_MARGIN,
            x2: x + width + BLUR_MARGIN,
            y2: Math.max(y + height, animate ? this.y + this.height : 0) + BLUR_MARGIN,
        });

        this.remove_transition('y');
        this.remove_transition('height');
        this.x = x;
        this.width = width;
        if (!animate) {
            this.y = y;
            this.height = height;
            return;
        }
        this.ease({
            y, height,
            duration: 110,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    popup() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._shown)
            return;
        this._shown = true;
        this.remove_transition('opacity');
        this.remove_transition('translation-y');
        if (!this.visible) {
            this.opacity = 0;
            this.translation_y = 4;
        }
        this.show();
        this.ease({
            opacity: 255,
            translation_y: 0,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    // 入力中は一瞬だけ非表示→再表示になることがあるので、少し待ってから閉じる
    popdown(delay = 60) {
        if (!this._shown || this._hideTimeoutId)
            return;
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._hideTimeoutId = 0;
            this._shown = false;
            this.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._shown)
                        this.hide();
                },
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    vfunc_destroy() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        super.vfunc_destroy();
    }
});

// fcitx5 の kimpanel アドオンが話すプロトコル(src/ui/kimpanel/kimpanel.cpp)
const ImpanelIface = `<node>
<interface name="org.kde.impanel">
  <signal name="MovePreeditCaret"><arg type="i" name="position"/></signal>
  <signal name="SelectCandidate"><arg type="i" name="index"/></signal>
  <signal name="LookupTablePageUp"/>
  <signal name="LookupTablePageDown"/>
  <signal name="TriggerProperty"><arg type="s" name="key"/></signal>
  <signal name="PanelCreated"/>
  <signal name="Exit"/>
  <signal name="ReloadConfig"/>
  <signal name="Configure"/>
</interface>
</node>`;

const Impanel2Iface = `<node>
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

const IM_PROPERTY = '/Fcitx/im';
const GAP = 6;
const SCREEN_MARGIN = 8;
// 候補文字の左端をカーソル位置に揃えるためのずらし量
const CANDIDATE_X_SHIFT = 34;
const INDICATOR_X_SHIFT = 10;
// fcitx5 の CandidateLayoutHint: 0=NotSet 1=Vertical 2=Horizontal
const LAYOUT_HORIZONTAL = 2;

// "key:label:icon:text:hint" 形式
function parseProperty(str) {
    const [key = '', label = '', icon = '', text = '', hint = ''] = str.split(':');
    const hints = hint ? hint.split(',') : [];
    const shortLabel = hints.find(h => h.startsWith('label='))?.slice('label='.length);
    return {key, label, icon, text, shortLabel};
}

// キーボード配列は "ja" などの言語コードで来るので "A" に揃える
function imDisplayLabel(prop) {
    if (prop.icon.startsWith('input-keyboard'))
        return 'A';
    return prop.shortLabel || prop.label.slice(0, 2);
}

class ImpanelService {
    constructor(ext) {
        this._ext = ext;
        this._impl = Gio.DBusExportedObject.wrapJSObject(ImpanelIface, this);
        this._impl.export(Gio.DBus.session, '/org/kde/impanel');
        this._impl2 = Gio.DBusExportedObject.wrapJSObject(Impanel2Iface, this);
        this._impl2.export(Gio.DBus.session, '/org/kde/impanel');

        this._signalId = Gio.DBus.session.signal_subscribe(
            null, 'org.kde.kimpanel.inputmethod', null, null, null,
            Gio.DBusSignalFlags.NONE,
            (_conn, sender, _path, _iface, signal, params) =>
                this._ext.onImSignal(sender, signal, params.deepUnpack()));

        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION, 'org.kde.impanel', Gio.BusNameOwnerFlags.NONE,
            null,
            () => {
                this._impl?.emit_signal('PanelCreated', null);
                this._impl2?.emit_signal('PanelCreated2', null);
            },
            null);
    }

    emit(name, variant = null) {
        this._impl?.emit_signal(name, variant);
    }

    SetSpotRect(x, y, w, h) {
        this._ext.setSpot({x, y, w, h, relative: false, scale: 1});
    }

    SetRelativeSpotRect(x, y, w, h) {
        this._ext.setSpot({x, y, w, h, relative: true, scale: 1});
    }

    SetRelativeSpotRectV2(x, y, w, h, scale) {
        this._ext.setSpot({x, y, w, h, relative: true, scale});
    }

    SetLookupTable(labels, texts, _attrs, hasPrev, hasNext, cursor, layout) {
        this._ext.setLookupTable({labels, texts, hasPrev, hasNext, cursor, layout});
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._signalId);
        Gio.bus_unown_name(this._ownerId);
        this._impl.unexport();
        this._impl2.unexport();
        this._impl = null;
        this._impl2 = null;
    }
}

// kimpanel 利用中は fcitx5 のトレイアイコンが消えるため、その代わり
const StatusIndicator = class {
    constructor(ext) {
        this._ext = ext;
        this.button = new PanelMenu.Button(0.5, 'Glass IME', false);
        this._label = new St.Label({
            style_class: 'glass-ime-status',
            y_align: Clutter.ActorAlign.CENTER,
            text: '',
        });
        this.button.add_child(this._label);

        this._imSection = new PopupMenu.PopupMenuSection();
        this.button.menu.addMenuItem(this._imSection);
        this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.button.menu.addAction('fcitx5 の設定', () => this._ext.service.emit('Configure'));
        this.button.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._ext.triggerProperty(IM_PROPERTY);
        });
        this.button.hide();
    }

    setLabel(label) {
        this._label.text = label;
        this.button.show();
    }

    setMenu(items) {
        this._imSection.removeAll();
        for (const item of items.map(parseProperty)) {
            this._imSection.addAction(item.label,
                () => this._ext.triggerProperty(item.key));
        }
    }

    clear() {
        this._imSection.removeAll();
        this.button.hide();
    }

    destroy() {
        this.button.destroy();
    }
};

export default class GlassIme {
    constructor(ext) {
        this.uuid = ext.uuid;
    }

    enable() {
        this._resetState();

        this._panel = new GlassPanel({styleClass: 'glass-ime-candidates'});
        this._panel.connect('scroll-event', (_actor, event) => {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP)
                this.service.emit('LookupTablePageUp');
            else if (dir === Clutter.ScrollDirection.DOWN)
                this.service.emit('LookupTablePageDown');
            return Clutter.EVENT_STOP;
        });

        this._indicator = new GlassPanel({styleClass: 'glass-ime-indicator', radius: 10});
        this._indicatorLabel = new St.Label({
            style_class: 'glass-ime-indicator-text',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._indicator.box.add_child(this._indicatorLabel);

        Main.layoutManager.addTopChrome(this._panel);
        Main.layoutManager.addTopChrome(this._indicator);

        this._status = new StatusIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._status.button);

        this.service = new ImpanelService(this);
    }

    disable() {
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
        this._unwatchIm();
        this.service?.destroy();
        this.service = null;
        this._status?.destroy();
        this._status = null;
        this._panel?.destroy();
        this._panel = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._indicatorLabel = null;
    }

    _resetState() {
        this._spot = {x: 0, y: 0, w: 0, h: 0, relative: false, scale: 1};
        this._table = {labels: [], texts: [], hasPrev: false, hasNext: false, cursor: -1, layout: 0};
        this._aux = '';
        this._imLabel = '';
        this._preedit = '';
        this._showAux = false;
        this._showPreedit = false;
        this._showLookupTable = false;
    }

    // ---- fcitx5 からの入力 ----

    onImSignal(sender, signal, args) {
        switch (signal) {
        case 'RegisterProperties':
            this._watchIm(sender);
            for (const prop of args[0].map(parseProperty)) {
                if (prop.key === IM_PROPERTY)
                    this._setImProperty(prop);
            }
            return;
        case 'UpdateProperty': {
            const prop = parseProperty(args[0]);
            if (prop.key === IM_PROPERTY)
                this._setImProperty(prop);
            return;
        }
        case 'ExecMenu':
            this._status.setMenu(args[0]);
            return;
        case 'UpdateAux':
            this._aux = args[0];
            break;
        case 'ShowAux':
            this._showAux = args[0];
            break;
        case 'UpdatePreeditText':
            this._preedit = args[0];
            break;
        case 'ShowPreedit':
            this._showPreedit = args[0];
            break;
        case 'ShowLookupTable':
            this._showLookupTable = args[0];
            break;
        case 'UpdateSpotLocation':
            this._spot = {x: args[0], y: args[1], w: 0, h: 0, relative: false, scale: 1};
            break;
        default:
            return;
        }
        this._queueUpdate();
    }

    _setImProperty(prop) {
        this._imLabel = imDisplayLabel(prop);
        this._status.setLabel(this._imLabel);
    }

    setSpot(spot) {
        this._spot = spot;
        this._queueUpdate();
    }

    setLookupTable(table) {
        this._table = table;
        this._queueUpdate();
    }

    triggerProperty(key) {
        this.service.emit('TriggerProperty', new GLib.Variant('(s)', [key]));
    }

    _watchIm(sender) {
        if (this._imOwner === sender)
            return;
        this._unwatchIm();
        this._imOwner = sender;
        this._imWatchId = Gio.bus_watch_name(
            Gio.BusType.SESSION, sender, Gio.BusNameWatcherFlags.NONE,
            null, () => this._onImVanished());
    }

    _unwatchIm() {
        if (this._imWatchId)
            Gio.bus_unwatch_name(this._imWatchId);
        this._imWatchId = 0;
        this._imOwner = null;
    }

    _onImVanished() {
        this._unwatchIm();
        this._resetState();
        this._status.clear();
        this._queueUpdate();
    }

    // ---- 描画 ----

    // fcitx5 は 1 回の更新で複数のシグナルを送ってくるので、フレーム毎にまとめる
    _queueUpdate() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _update() {
        const hasCandidates = this._showLookupTable && this._table.texts.length > 0;
        const hasPreedit = this._showPreedit && this._preedit !== '';
        const hasAux = this._showAux && this._aux !== '';

        // 候補も未確定文字列もなく補助テキストだけ = 入力メソッド切替の通知
        if (hasAux && !hasCandidates && !hasPreedit) {
            this._panel.popdown();
            // 補助テキストは "あ (Hiragana)" のような長い形なので、入力モードの短い表示を優先する
            this._indicatorLabel.text = this._imLabel || this._aux.replace(/\s*\(.*\)$/, '');
            this._place(this._indicator, INDICATOR_X_SHIFT);
            this._indicator.popup();
            return;
        }
        this._indicator.popdown();

        if (!hasCandidates && !hasPreedit) {
            this._panel.popdown();
            return;
        }
        this._rebuildPanel(hasAux, hasPreedit, hasCandidates);
        this._place(this._panel, CANDIDATE_X_SHIFT);
        this._panel.popup();
    }

    _rebuildPanel(hasAux, hasPreedit, hasCandidates) {
        const surface = this._panel.box;
        surface.destroy_all_children();

        if (hasPreedit)
            surface.add_child(new St.Label({style_class: 'glass-ime-preedit', text: this._preedit}));
        if (hasAux)
            surface.add_child(new St.Label({style_class: 'glass-ime-aux', text: this._aux}));
        if (!hasCandidates)
            return;

        const {labels, texts, cursor, layout} = this._table;
        const horizontal = layout === LAYOUT_HORIZONTAL;
        const list = new St.BoxLayout({
            style_class: horizontal ? 'glass-ime-list horizontal' : 'glass-ime-list',
            vertical: !horizontal,
        });
        const hasLabels = labels.some(l => l !== '');

        texts.forEach((text, i) => {
            // fcitx5 は auxDown を「ラベル無しの先頭候補」として送ってくる
            if (hasLabels && labels[i] === '') {
                surface.add_child(new St.Label({style_class: 'glass-ime-aux', text}));
                return;
            }
            const row = new St.BoxLayout({
                style_class: i === cursor ? 'glass-ime-candidate selected' : 'glass-ime-candidate',
                reactive: true,
                track_hover: true,
            });
            if (labels[i]) {
                row.add_child(new St.Label({
                    style_class: 'glass-ime-candidate-label',
                    text: labels[i].replace(/[.:]\s*$/, ''),
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            row.add_child(new St.Label({
                style_class: 'glass-ime-candidate-text',
                text,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            row.connect('button-release-event', () => {
                this.service.emit('SelectCandidate', new GLib.Variant('(i)', [i]));
                return Clutter.EVENT_STOP;
            });
            list.add_child(row);
        });
        surface.add_child(list);
    }

    _spotStageRect() {
        const {x, y, w, h, relative, scale} = this._spot;
        const focusWindow = global.display.focus_window;
        let rect = new Mtk.Rectangle({x, y, width: w, height: h});

        if (relative && focusWindow) {
            const shellScale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const k = shellScale / scale;
            rect = new Mtk.Rectangle({x: x * k, y: y * k, width: w * k, height: h * k});
            if (focusWindow.protocol_to_stage_rect)
                rect = focusWindow.protocol_to_stage_rect(rect);
            const actor = focusWindow.get_compositor_private();
            if (actor) {
                rect.x += actor.x;
                rect.y += actor.y;
            }
        } else if (focusWindow?.protocol_to_stage_rect) {
            rect = focusWindow.protocol_to_stage_rect(rect);
        }
        return rect;
    }

    _place(actor, xShift) {
        const rect = this._spotStageRect();
        const monitors = Main.layoutManager.monitors;
        const index = global.display.get_monitor_index_for_rect(rect);
        const monitor = monitors[index] ?? Main.layoutManager.primaryMonitor;
        const [width, height] = actor.naturalSize;

        let x = rect.x - xShift;
        let y = rect.y + rect.height + GAP;
        if (monitor) {
            if (y + height > monitor.y + monitor.height - SCREEN_MARGIN)
                y = rect.y - height - GAP;
            x = Math.min(x, monitor.x + monitor.width - width - SCREEN_MARGIN);
            x = Math.max(x, monitor.x + SCREEN_MARGIN);
            y = Math.max(y, monitor.y + SCREEN_MARGIN);
        }
        actor.moveResize(Math.round(x), Math.round(y), width, height);
    }
}
