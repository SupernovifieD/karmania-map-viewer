/**
 * The kinds of file the file picker offers first: the extensions the kernel reads (the `.prj` of a
 * data file goes with it), and `.txt`, which delimited text often has. The picker lets a person
 * choose any file all the same; what the kernel makes of it is for the wizard to say.
 */
export const IMPORT_FILE_ACCEPT = [
  '.csv',
  '.tsv',
  '.tab',
  '.txt',
  '.geojson',
  '.json',
  '.asc',
  '.obj',
  '.prj',
].join(',');
