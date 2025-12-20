import { getParser } from '../src/parser';
import { buildWiring } from '../src/wire';
import { Schema } from '../src/schema-type';

export async function generateWiringFromString(schemaContent: string) {
  const parser = await getParser();
  const schema: Schema = parser.parse(schemaContent);
  return buildWiring(schema);
}
