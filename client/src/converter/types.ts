export type MappedFile = {
    path: string;
    data: Uint8Array;
};

export type GameVersion = 'tr1' | 'tr2' | 'tr3';

export type Language = {
    code: string;
    name: string;
};

export type ConversionOptions = {
    modId: string;
    templateMod: string;
    useOutfitImport: boolean;
    language?: string;
};

export type ConversionResult = {
    files: MappedFile[];
    detectedLanguages: Language[];
    warnings: string[];
};

export type ScriptInfo = {
    filenames: string[];
    levelTitles: string[];
    musicTracks: number[];
    sequences: (Record<string, unknown>[] | null)[];
    titleSoundId: number;
    cdOffset: number;
};
