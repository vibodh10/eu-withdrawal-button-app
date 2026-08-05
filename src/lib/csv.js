export function toCsv(rows = []) {
  const headers = [
    'reference',
    'customerName',
    'customerEmail',
    'orderNumber',
    'status',
    'locale',
    'submittedAt'
  ];

    const escape = (value) => {
        if (value === null || value === undefined) {
            return "";
        }

        let str = String(value);

        if (/^[=+\-@]/.test(str)) {
            str = `'${str}`;
        }

        str = str.replaceAll('"', '""');

        return `"${str}"`;
    };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.publicReference,
      row.customerName,
      row.customerEmail,
      row.orderNumber,
      row.status,
      row.locale,
      row.submittedAt?.toISOString?.() || row.submittedAt
    ].map(escape).join(','));
  }

  return lines.join('\n');
}
