export function uint64Bytes(value) {
    if (value < 0n || value >= 2n ** 64n) {
        throw new Error("uint64 out of range");
    }
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value);
    return out;
}
export function readUint64(data, offset) {
    return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0);
}
export function concat(parts) {
    const size = parts.reduce((total, part) => total + part.byteLength, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}
//# sourceMappingURL=codec.js.map