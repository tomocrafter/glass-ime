// A development reload imports a fresh copy of every module, which would
// otherwise register the same GType names twice.
const LOAD_ID = Math.random().toString(36).slice(2);

export function uniqueTypeName(name: string): string {
    return `GlassIme_${name}_${LOAD_ID}`;
}
