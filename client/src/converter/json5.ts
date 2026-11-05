// Reads the JSON5 TRX's files are written in: comments, trailing commas,
// unquoted keys, single-quoted strings and numbers with a leading `+`. The
// text is rewritten as JSON outside its strings, so a `//` inside a string,
// such as a URL, is left alone.
export function parseJSON5(text: string): unknown {
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '"' || c === "'") {
            // A string, re-quoted with double quotes.
            let j = i + 1;
            let body = '';
            while (j < n && text[j] !== c) {
                if (text[j] === '\\' && j + 1 < n) {
                    // An escaped single quote needs no escape in double quotes.
                    body += text[j + 1] === "'" ? "'" : text[j] + text[j + 1];
                    j += 2;
                    continue;
                }
                if (text[j] === '"') body += '\\"';
                else if (text[j] === '\n') body += '\\n';
                else body += text[j];
                j++;
            }
            out += '"' + body + '"';
            i = j + 1;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i++;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? n : end + 2;
        } else if (c === '+' && /[\d.]/.test(text[i + 1] ?? '')) {
            i++;
        } else if (c === '0' && /[xXbB]/.test(text[i + 1] ?? '')) {
            // Hexadecimal, and the binary TRX's own reader takes as well.
            const binary = /[bB]/.test(text[i + 1]);
            let j = i + 2;
            while (j < n && (binary ? /[01]/ : /[\da-fA-F]/).test(text[j])) j++;
            out += String(parseInt(text.slice(i + 2, j), binary ? 2 : 16));
            i = j;
        } else if (/\d/.test(c) || (c === '.' && /\d/.test(text[i + 1] ?? ''))) {
            // A number, with the leading or trailing point JSON lacks.
            let j = i;
            while (j < n && /[\d.eE+-]/.test(text[j]) && !(j > i && /[+-]/.test(text[j]) && !/[eE]/.test(text[j - 1]))) j++;
            const number = text.slice(i, j);
            out += String(Number(number.replace(/^\./, '0.').replace(/\.$/, '.0')));
            i = j;
        } else if (/[A-Za-z_$]/.test(c)) {
            let j = i;
            while (j < n && /[\w$]/.test(text[j])) j++;
            const word = text.slice(i, j);
            // An unquoted key is followed by a colon; true, false, null and
            // the numbers JSON lacks are values.
            let k = j;
            while (k < n && /\s/.test(text[k])) k++;
            if (text[k] === ':') out += JSON.stringify(word);
            else if (word === 'Infinity' || word === 'NaN') out += 'null';
            else out += word;
            i = j;
        } else {
            out += c;
            i++;
        }
    }
    return JSON.parse(out.replace(/,(\s*[\]}])/g, '$1'));
}
