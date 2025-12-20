import type { Argument, TypeReference } from '../language/generated/ast.js';

export const getTSForTypeReference = (type: TypeReference): string => {
  if (type.array) {
    return `${type.reference}[]`;
  }
  return type.reference;
};

export const getTSForArgument = (arg: Argument): string => {
  return getTSForTypeReference(arg.type);
};
