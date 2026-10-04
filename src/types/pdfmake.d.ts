/**
 * pdfmake 0.3 ships no type declarations, so the parts used here are declared
 * locally. Deliberately narrow: a report PDF is a table, a few tiles and a
 * footer, and typing the whole document definition here would be a copy of
 * pdfmake's own docs that could drift.
 *
 * The imported module is CommonJS (`module.exports = new pdfmake()`), which is
 * why the default import is used rather than a named one.
 */
declare module "pdfmake/js" {
  export type PdfContent = Record<string, unknown> | PdfContent[] | string | number;

  export type PdfFontFile = {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  };

  export type PdfTableCell = {
    text: string;
    bold?: boolean;
    fontSize?: number;
    alignment?: "left" | "right" | "center";
    fillColor?: string;
    color?: string;
    margin?: number | [number, number, number, number];
  };

  export type PdfDocument = {
    content: PdfContent[];
    defaultStyle?: Record<string, unknown>;
    styles?: Record<string, Record<string, unknown>>;
    pageOrientation?: "portrait" | "landscape";
    pageSize?: string;
    pageMargins?: number | [number, number, number, number];
    /** May be a function, so the footer can print the page number. */
    footer?: PdfContent | ((currentPage: { pageNumber: number; pageCount: number }) => PdfContent);
    info?: Record<string, string>;
  };

  export type PdfDocumentBuilder = {
    getBuffer: () => Promise<Buffer>;
    getStream: () => NodeJS.ReadableStream;
  };

  export type PdfMake = {
    virtualfs: {
      writeFileSync: (filename: string, content: Buffer | string, encoding?: BufferEncoding) => void;
      readFileSync: (filename: string) => Buffer;
      existsSync: (filename: string) => boolean;
    };
    /** Restricts what the document definition may pull off the local disk. */
    setLocalAccessPolicy: (policy: (path: string) => boolean) => void;
    setUrlAccessPolicy: (policy: (url: string) => boolean) => void;
    addFonts: (fonts: Record<string, PdfFontFile>) => void;
    createPdf: (document: PdfDocument) => PdfDocumentBuilder;
  };

  const pdfMake: PdfMake;
  export default pdfMake;
}