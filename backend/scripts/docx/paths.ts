import * as path from 'path';

export const DOCX_OUTPUT_DIR = path.resolve(__dirname, 'output');

export function templateOutputDir(slug: string): string {
  return path.join(DOCX_OUTPUT_DIR, slug);
}
