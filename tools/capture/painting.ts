import type Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=3.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

const BLOBS: { x: number; y: number; radius: number; color: string }[] = [
    { x: 15, y: 20, radius: 45, color: '#ffa894' },
    { x: 52, y: 12, radius: 40, color: '#a8bdff' },
    { x: 86, y: 30, radius: 45, color: '#ffd68c' },
    { x: 32, y: 82, radius: 42, color: '#94e0cc' },
    { x: 74, y: 88, radius: 42, color: '#d6a8ff' },
];

function pastelSvg(width: number, height: number): string {
    const size = Math.max(width, height);
    const gradients = BLOBS.map(
        ({ color }, index) =>
            `<radialGradient id="b${index}"><stop offset="0" stop-color="${color}" stop-opacity="0.95"/>` +
            `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    );
    const circles = BLOBS.map(
        ({ x, y, radius }, index) =>
            `<circle cx="${(x / 100) * width}" cy="${(y / 100) * height}" r="${(radius / 100) * size}" fill="url(#b${index})"/>`,
    );

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<defs>${gradients.join('')}</defs>` +
        `<rect width="100%" height="100%" fill="#f5f0ec"/>${circles.join('')}</svg>`
    );
}

const pastelCache = new Map<string, GdkPixbuf.Pixbuf>();

/** Soft pastel color field, so that the glass has something colorful to blur. */
export function paintPastel(cr: Cairo.Context, width: number, height: number): void {
    const key = `${width}x${height}`;
    let pixbuf = pastelCache.get(key);

    if (!pixbuf) {
        const loader = new GdkPixbuf.PixbufLoader();
        loader.write_bytes(new GLib.Bytes(new TextEncoder().encode(pastelSvg(width, height))));
        loader.close();
        pixbuf = loader.get_pixbuf() ?? undefined;
    }

    if (pixbuf) {
        pastelCache.set(key, pixbuf);
        Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
        cr.paint();
    }
}

export function roundedRect(
    cr: Cairo.Context,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    cr.newSubPath();
    cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2);
    cr.closePath();
}

export interface TextOptions {
    font: string;
    width?: number;
    lineSpacing?: number;
}

export function createText(cr: Cairo.Context, text: string, options: TextOptions): Pango.Layout {
    const layout = PangoCairo.create_layout(cr);
    layout.set_font_description(Pango.FontDescription.from_string(options.font));
    layout.set_text(text, -1);

    if (options.width) {
        layout.set_width(options.width * Pango.SCALE);
        layout.set_wrap(Pango.WrapMode.CHAR);
    }

    if (options.lineSpacing) {
        layout.set_line_spacing(options.lineSpacing);
    }

    return layout;
}

export function drawText(cr: Cairo.Context, layout: Pango.Layout, x: number, y: number): void {
    cr.moveTo(x, y);
    PangoCairo.show_layout(cr, layout);
}
