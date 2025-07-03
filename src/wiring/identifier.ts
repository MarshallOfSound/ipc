import { Array, Identifier, IdentifierIDX, MethodArgument } from "../schema-type"

export const getTSForIdentifier = (ident: MethodArgument | Identifier | Array | IdentifierIDX): string => {
  switch (ident.type) {
    case 'Argument':
      return `${getTSForIdentifier(ident.argType)}`;
    case 'Array':
      return `${ident.name}[]`;
    case 'Identifier':
      return ident.name;
    case 'IdentifierIDX':
      return `${ident.name}[${getTSForIdentifier(ident.idxKey)}]`
  }
}