import { Controller } from '../controller.js';
import type { KeyValueBlock, PropertyType, Structure, StructureBlock, StructureProperty, TypeReference } from '../language/generated/ast.js';
import { basePrimitives, INLINE_STRUCTURE_JOINER, validator } from './_constants.js';
import { getTSForTypeReference } from './identifier.js';

const validatorFnOrPrimitiveValidator = (type: PropertyType, jsValueName: string, inlineStructureName: string): string => {
  if (type.$type === 'TypeReference') {
    return validatorFnOrPrimitiveValidatorForType(type, jsValueName);
  }
  // For inline structures and key-value blocks, use the generated validator
  return `${validator(inlineStructureName)}(${jsValueName})`;
};

const validatorFnOrPrimitiveValidatorForType = (type: TypeReference, jsValueName: string): string => {
  const baseType = type.reference;
  let baseCheck = basePrimitives.includes(baseType) ? (baseType === 'unknown' ? 'true' : `(typeof ${jsValueName} === '${baseType}')`) : `${validator(baseType)}(${jsValueName})`;

  if (type.array) {
    baseCheck = `(Array.isArray(${jsValueName}) && ${jsValueName}.every((v: any) => ${validatorFnOrPrimitiveValidatorForType({ ...type, array: false } as TypeReference, 'v')}))`;
  }
  return baseCheck;
};

export function wireKeyValueMap(kvm: KeyValueBlock, pseudoName: string, controller: Controller): void {
  const getInlineStructureName = () => `${pseudoName}${INLINE_STRUCTURE_JOINER}_$MappedValue$_`;

  const inlineStructureName = getInlineStructureName();
  let valueName: string;

  switch (kvm.type.$type) {
    case 'StructureBlock': {
      wireInlineStructure(kvm.type, inlineStructureName, controller);
      valueName = inlineStructureName;
      break;
    }
    case 'KeyValueBlock': {
      wireKeyValueMap(kvm.type, inlineStructureName, controller);
      valueName = inlineStructureName;
      break;
    }
    case 'TypeReference': {
      valueName = getTSForTypeReference(kvm.type);
      break;
    }
  }

  const structureDeclaration = [`export type ${pseudoName} = Record<string, ${valueName}>;`];

  const structureValidatorDeclaration = [
    `export function ${validator(pseudoName)}(value: any): boolean {`,
    `  if (!value || typeof value !== 'object') return false;`,
    `  for (const key of Object.keys(value)) {`,
    `    if (typeof key !== 'string') return false;`,
    `    if (!${kvm.type.$type === 'TypeReference' ? validatorFnOrPrimitiveValidatorForType(kvm.type, 'value[key]') : `${validator(valueName)}(value[key])`}) return false`,
    `  }`,
    `  return true;`,
    `}`,
  ];

  controller.addCommonCode(structureDeclaration.join('\n'));
  controller.addCommonRuntimeCode(structureValidatorDeclaration.join('\n'));
  controller.addCommonExport(pseudoName);
  controller.addCommonRuntimeExport(validator(pseudoName));
}

function maybeNullable(s: string, nullable: boolean) {
  if (nullable) {
    return `(${s}) | null`;
  }
  return s;
}

function getTypeString(type: PropertyType, inlineName: string): string {
  switch (type.$type) {
    case 'TypeReference':
      return getTSForTypeReference(type);
    case 'StructureBlock':
    case 'KeyValueBlock':
      return inlineName;
  }
}

function wireInlineStructure(block: StructureBlock, name: string, controller: Controller): void {
  const getInlineStructureName = (propertyName: string) => `${name}${INLINE_STRUCTURE_JOINER}${propertyName}`;

  const structureDeclaration = [
    `export interface ${name} {`,
    ...block.properties.map((property) => {
      const keyPrefix = `  ${property.name}${property.optional ? '?' : ''}`;
      const inlineName = getInlineStructureName(property.name);
      const typeStr = getTypeString(property.type, inlineName);
      return `${keyPrefix}: ${maybeNullable(typeStr, property.nullable)};`;
    }),
    '}',
  ];

  const structureValidatorDeclaration = [
    `export function ${validator(name)}(value: any): boolean {`,
    `  if (!value || typeof value !== 'object') return false;`,
    ...block.properties.map((property) => {
      const inlineStructureName = getInlineStructureName(property.name);

      // Wire nested structures
      if (property.type.$type === 'StructureBlock') {
        wireInlineStructure(property.type, inlineStructureName, controller);
      } else if (property.type.$type === 'KeyValueBlock') {
        wireKeyValueMap(property.type, inlineStructureName, controller);
      }

      return [
        '',
        `  // ${name}.${property.name}`,
        ...(property.optional ? [`  if (typeof value.${property.name} !== 'undefined') {`] : []),
        `  ${property.optional ? '  ' : ''}if (${property.nullable ? `value.${property.name} !== null && ` : ''}!${validatorFnOrPrimitiveValidator(property.type, `value.${property.name}`, inlineStructureName)}) return false;`,
        ...(property.optional ? [`  }`] : []),
      ].join('\n');
    }),
    `  return true;`,
    `}`,
  ];

  controller.addCommonCode(structureDeclaration.join('\n'));
  controller.addCommonRuntimeCode(structureValidatorDeclaration.join('\n'));
  controller.addCommonExport(name);
  controller.addCommonRuntimeExport(validator(name));
}

export function wireStructure(structure: Structure, allowedTypes: Set<string>, controller: Controller): void {
  const getInlineStructureName = (propertyName: string) => `${structure.name}${INLINE_STRUCTURE_JOINER}${propertyName}`;

  const structureDeclaration = [
    `export interface ${structure.name} {`,
    ...structure.block.properties.map((property) => {
      const keyPrefix = `  ${property.name}${property.optional ? '?' : ''}`;
      const inlineName = getInlineStructureName(property.name);
      const typeStr = getTypeString(property.type, inlineName);
      return `${keyPrefix}: ${maybeNullable(typeStr, property.nullable)};`;
    }),
    '}',
  ];

  const structureValidatorDeclaration = [
    `export function ${validator(structure.name)}(value: any): boolean {`,
    `  if (!value || typeof value !== 'object') return false;`,
    ...structure.block.properties.map((property) => {
      const inlineStructureName = getInlineStructureName(property.name);

      // Wire nested structures
      if (property.type.$type === 'StructureBlock') {
        wireInlineStructure(property.type, inlineStructureName, controller);
      } else if (property.type.$type === 'KeyValueBlock') {
        wireKeyValueMap(property.type, inlineStructureName, controller);
      }

      return [
        '',
        `  // ${structure.name}.${property.name}`,
        ...(property.optional ? [`  if (typeof value.${property.name} !== 'undefined') {`] : []),
        `  ${property.optional ? '  ' : ''}if (${property.nullable ? `value.${property.name} !== null && ` : ''}!${validatorFnOrPrimitiveValidator(property.type, `value.${property.name}`, inlineStructureName)}) return false;`,
        ...(property.optional ? [`  }`] : []),
      ].join('\n');
    }),
    `  return true;`,
    `}`,
  ];

  controller.addCommonCode(structureDeclaration.join('\n'));
  controller.addCommonRuntimeCode(structureValidatorDeclaration.join('\n'));
  controller.addCommonExport(structure.name);
  controller.addCommonRuntimeExport(validator(structure.name));
}
