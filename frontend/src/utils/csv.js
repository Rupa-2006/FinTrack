// A small, strict CSV reader (RFC 4180): quoted fields, doubled quotes, line breaks inside
// quotes, CRLF or LF, a UTF-8 byte-order mark. The separator (comma, semicolon or tab) is
// detected from the first line, so files from spreadsheets set to other locales work too.
export function detectSeparator(firstLine) {
  const counts = [',', ';', '\t'].map((sep) => ({ sep, n: firstLine.split(sep).length - 1 }));
  return counts.sort((a, b) => b.n - a.n)[0].n > 0 ? counts[0].sep : ',';
}

export function parseCsv(input) {
  const raw = String(input ?? '');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // drop a UTF-8 byte-order mark
  const firstLineEnd = text.search(/\r?\n/);
  const sep = detectSeparator(firstLineEnd === -1 ? text : text.slice(0, firstLineEnd));
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === sep) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { separator: sep, headers: headers.map((h) => h.trim()), rows };
}
