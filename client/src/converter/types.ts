export type MappedFile = {
    path: string;
    data: Uint8Array;
};

export type GameVersion = '1' | '2' | '3';

export type Language = {
    code: string;
    name: string;
};

export type ConversionOptions = {
    modId: string;
    gameVersion: number;
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
    // The title screen's files: its level, then its pictures.
    titleFiles: string[];
    fmvFiles: string[];
    cutsceneFiles: string[];
    // The music each cutscene plays, from the track set just before it.
    cutsceneTracks: number[];
};
