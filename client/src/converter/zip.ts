import { zipSync } from 'fflate';
import type { MappedFile } from './types.ts';

export function createOutputZip(files: MappedFile[]): Uint8Array {
    const zipData: Record<string, Uint8Array> = {};
    for (let i = 0; i < files.length; i++) {
        zipData[files[i].path] = files[i].data;
    }
    return zipSync(zipData);
}
