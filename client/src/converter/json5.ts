export function parseJSON5(text: string): unknown {
    text = text.replace(/\/\/.*$/gm, '');
    text = text.replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(text);
}
